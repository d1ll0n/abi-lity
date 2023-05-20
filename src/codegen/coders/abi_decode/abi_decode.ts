import { FunctionDefinition, FunctionStateMutability, assert } from "solc-typed-ast";
import {
  ArrayType,
  BytesType,
  DefaultVisitor,
  StructType,
  TupleType,
  TypeNode,
  UABIType
} from "../../../ast";
import { functionDefinitionToTypeNode } from "../../../readers/read_solc_ast";
import { StructuredText, coerceArray, toHex } from "../../../utils";
import {
  canCombineTailCopies,
  canDeriveSizeInOneStep,
  getSequentiallyCopyableSegments,
  roundUpAdd32
} from "../../utils";
import NameGen, { NameGenKey, NameGenParameters, NameGenTypeParams } from "../../names";
import { EncodingScheme } from "../../../constants";
import { getMemberDataOffset, getMemberHeadOffset, getOffsetExpression } from "../../offsets";
import { WrappedScope } from "../../ctx/contract_wrapper";
import { abiDecodeBytes } from "../templates/templates";

export function abiDecodingFunction(ctx: WrappedScope, node: TypeNode): string {
  const visitor = AbiDecodeVisitor.getVisitor(ctx);
  return visitor.accept(node);
}

export function getDecoderForFunction(ctx: WrappedScope, fn: FunctionDefinition): string {
  ctx.addDependencyImports(fn);
  const type = functionDefinitionToTypeNode(fn);
  if (!type.parameters) throw Error(`Can not decode function without parameters`);
  return abiDecodingFunction(ctx, type.parameters);
  // const decoderFn = getDecodeParametersTuple(ctx, type.parameters);
  // return decoderFn;
}

export const VisitorByScope: WeakMap<WrappedScope, AbiDecodeVisitor> = new Map();

/**
 * The `visit` function should return a string that is the name of the function
 * that will decode the given type. If the type has already been visited, the
 * `_shouldSkipVisitWith` function will return the name of the function that
 * has already been generated.
 */
export class AbiDecodeVisitor extends DefaultVisitor {
  existingTypeFunctions: Map<string, string> = new Map();

  constructor(private ctx: WrappedScope) {
    super();
    VisitorByScope.set(ctx, this);
  }

  static getVisitor(ctx: WrappedScope): AbiDecodeVisitor {
    let visitor = VisitorByScope.get(ctx);
    if (!visitor) {
      visitor = new AbiDecodeVisitor(ctx);
    }
    return visitor;
  }

  protected _shouldSkipVisitWith(type: TypeNode): string | undefined {
    return this.existingTypeFunctions.get(type.identifier);
  }

  get defaultReturnValue(): any {
    throw new Error("No default decoder.");
  }

  protected _afterVisit<T extends UABIType>(_type: T, result: any): string {
    this.existingTypeFunctions.set(_type.identifier, result);
    return result;
  }

  protected _memberHeadOffset(member: TypeNode, encoding: EncodingScheme): string {
    return getMemberHeadOffset(
      this.ctx,
      encoding === EncodingScheme.SolidityMemory ? "mPtr" : "cdPtr",
      member,
      encoding
    );
  }

  protected _memberDataOffset(member: TypeNode, encoding: EncodingScheme): string {
    return getMemberDataOffset(
      this.ctx,
      encoding === EncodingScheme.SolidityMemory ? "mPtr" : "cdPtr",
      member,
      encoding
    );
  }

  getConstant<K extends NameGenKey>(
    key: K,
    value: string | number,
    ...args: NameGenParameters<K>
  ): string {
    return this.ctx.addConstant((NameGen as NameGenTypeParams)[key](...args), value);
  }

  addDecoderFunction(
    type: TypeNode,
    inputParams: string | string[],
    outputParams: string | string[],
    body: StructuredText,
    comment?: StructuredText
  ): string {
    inputParams = coerceArray(inputParams)
      .map((p) => `CalldataPointer ${p}`)
      .join(", ");
    outputParams = coerceArray(outputParams)
      .map((p) => `MemoryPointer ${p}`)
      .join(", ");
    return this.ctx.addInternalFunction(
      NameGen.innerAbiDecode(type),
      inputParams,
      outputParams,
      body,
      FunctionStateMutability.Pure,
      comment
    );
  }

  visitBytes(type: BytesType): string {
    return this.addDecoderFunction(type, "cdPtrLength", "mPtrLength", abiDecodeBytes.code);
  }

  visitStruct(struct: StructType): string {
    const sizeName = this.getConstant(
      "headSize",
      toHex(struct.embeddedMemoryHeadSize),
      struct,
      EncodingScheme.SolidityMemory
    );
    const body: StructuredText[] = [`mPtr = malloc(${sizeName});`];
    const segments = getSequentiallyCopyableSegments(struct);
    segments.forEach((segment, i) => {
      let size = toHex(segment.length * 32);
      if (segments.length === 1 && segment.length === struct.vMembers.length) {
        size = sizeName;
      } else if (segment.length === 1) {
        if (segment[0].isValueType) {
          size = this.ctx.addConstant(`OneWord`, "0x20");
        } else {
          size = this.getConstant("structMemberSize", size, segment[0]);
        }
      } else {
        size = this.getConstant("fixedSegment", size, struct, i);
      }
      const src = this._memberDataOffset(segment[0], EncodingScheme.ABI);
      const dst = this._memberHeadOffset(segment[0], EncodingScheme.SolidityMemory);

      body.push(
        `// Copy ${segment.map((s) => s.labelFromParent).join(", ")}`,
        `${src}.copy(${dst}, ${size});`
      );
    });

    const referenceTypes = struct.vMembers.filter((type) => type.isReferenceType);
    for (const member of referenceTypes) {
      const src = this._memberDataOffset(member, EncodingScheme.ABI);
      const dst = this._memberHeadOffset(member, EncodingScheme.SolidityMemory);
      const decodeFn = this.visit(member);
      body.push(`${dst}.write(${decodeFn}(${src}));`);
    }

    return this.addDecoderFunction(struct, `cdPtr`, `mPtr`, body);
  }

  visitTuple(type: TupleType): string {
    const returnParameters = type.vMembers.map(
      (node, i) => `${node.labelFromParent ?? `value${i}`}`
    );
    const inner: StructuredText = [];
    type.vMembers.forEach((member, i) => {
      const name = member.labelFromParent ?? `value${i}`;
      const src = getOffsetExpression(
        "CalldataStart",
        type.calldataOffsetOfChild(member),
        type.isDynamicallyEncoded
      );
      if (member.isValueType) {
        const fnName = `read${member.identifier[0].toUpperCase() + member.identifier.slice(1)}`;
        inner.push(`${name} = ${src}.${fnName}();`);
      } else {
        inner.push(`${name} = ${this.visit(member)}(${src});`);
      }
    });

    const decodeType = type.vMembers.length > 1 ? type : type.vMembers[0];
    return this.addDecoderFunction(decodeType, [], returnParameters, inner);
  }

  visitArray(type: ArrayType): string {
    if (type.baseType.isValueType) {
      return this.decodeValueArray(type);
    }
    if (canCombineTailCopies(type.baseType)) {
      if (type.baseType.isDynamicallyEncoded) {
        return this.decodeArrayCombinedDynamicTail(type);
      }
      return this.decodeArrayCombinedStaticTail(type);
    }
    return this.decodeArraySeparateTail(type);
  }

  buildGetTailSize(type: TypeNode, ptr: string): string {
    if (type.maxNestedReferenceTypes > 1) {
      throw Error(
        `getTailSize not implemented for ${type.identifier}\ntoo many nested reference type`
      );
    }
    if (type instanceof BytesType) return roundUpAdd32(this.ctx, `calldataload(${ptr})`);

    if (type instanceof ArrayType && type.baseType.isValueType) {
      if (type.isDynamicallySized) return `mul(add(calldataload(${ptr}), 1), 0x20)`;
      return toHex(32 * (type.length as number));
    }
    if (type instanceof StructType) {
      return this.getConstant("tailSize", toHex(type.memoryDataSize as number), type);
    }

    throw Error(`getTailSize not implemented for ${type.identifier}`);
  }

  /**
   * Generates an ABI decoding function for an array with a dynamic base type
   * where the tails can be combined into a single copy, assuming strict encoding,
   * which is checked.
   */
  decodeArrayCombinedDynamicTail(type: ArrayType): string {
    assert(
      canDeriveSizeInOneStep(type.baseType),
      `Can not derive size in one step for ${type.canonicalName} - ${type.baseType.maxNestedDynamicTypes} dynamic ${type.baseType.maxNestedReferenceTypes} reference`
    );
    const tailSizeExpression = this.buildGetTailSize(type.baseType, `cdPtrItemLength`);

    const body: string[] = [];
    let inPtr = "cdPtrLength";
    let outPtr = "mPtrLength";
    if (type.isDynamicallySized) {
      body.push(
        `let arrLength := calldataload(cdPtrLength)`,
        ``,
        `mPtrLength := mload(0x40)`,
        `mstore(mPtrLength, arrLength)`,
        ``,
        `let mPtrHead := add(mPtrLength, 32)`,
        `let cdPtrHead := add(cdPtrLength, 32)`,
        ` `,
        `let tailOffset :=  mul(arrLength, 0x20)`
      );
    } else {
      inPtr = "cdPtrHead";
      outPtr = "mPtrHead";
      const headSize = this.getConstant(
        "headSize",
        toHex(type.embeddedMemoryHeadSize as number),
        type,
        EncodingScheme.SolidityMemory
      );
      body.push(`mPtrHead := mload(0x40)`, `let tailOffset := ${headSize}`);
    }
    body.push(
      ` `,
      `let mPtrTail := add(mPtrHead, tailOffset)`,
      `let totalOffset := tailOffset`,
      `let isInvalid := 0`,
      `for {let offset := 0} lt(offset, tailOffset) { offset := add(offset, 32) } {`,
      `  mstore(add(mPtrHead, offset), add(mPtrHead, totalOffset))`,
      `  let cdOffsetItemLength := calldataload(add(cdPtrHead, offset))`,
      `  isInvalid := or(isInvalid, xor(cdOffsetItemLength, totalOffset))`,
      `  let cdPtrItemLength := add(cdPtrHead, cdOffsetItemLength)`,
      `  let length := ${tailSizeExpression}`,
      `  totalOffset := add(totalOffset, length)`,
      `}`,
      `if isInvalid {revert(0, 0)}`,
      `calldatacopy(`,
      `  mPtrTail,`,
      `  add(cdPtrHead, tailOffset),`,
      `  sub(totalOffset, tailOffset)`,
      `)`,
      `mstore(0x40, add(mPtrHead, totalOffset))`
    );
    return this.addDecoderFunction(type, inPtr, outPtr, [`assembly {`, body, `}`]);
  }

  /**
   * Generates an ABI decoding function for an array of fixed-size reference types
   * that can be combined into a single copy (no embedded reference types).
   */
  decodeArrayCombinedStaticTail(type: ArrayType): string {
    const tailSizeName = this.getConstant(
      "tailSize",
      toHex(type.baseType.memoryDataSize as number),
      type.baseType,
      EncodingScheme.SolidityMemory
    );

    const body: StructuredText[] = [];
    let inPtr = "cdPtrLength";
    let outPtr = "mPtrLength";
    let tailSizeExpression = `mul(arrLength, ${tailSizeName})`;
    let copyStartExpression = "add(cdPtrLength, 0x20)";
    if (type.isDynamicallySized) {
      body.push(
        `let arrLength := calldataload(cdPtrLength)`,
        ``,
        `mPtrLength := mload(0x40)`,
        `mstore(mPtrLength, arrLength)`,
        ``,
        `let mPtrHead := add(mPtrLength, 32)`,
        `let mPtrTail := add(mPtrHead, mul(arrLength, 0x20))`
      );
    } else {
      inPtr = "cdPtrHead";
      outPtr = "mPtrHead";
      body.push(
        `mPtrHead := mload(0x40)`,
        `let mPtrTail := add(mPtrHead, ${toHex(32 * (type.length as number))})`
      );
      tailSizeExpression = this.getConstant(
        "tailSize",
        toHex(type.memoryDataSize as number),
        type,
        EncodingScheme.SolidityMemory
      );
      copyStartExpression = inPtr;
    }
    body.push(
      `let mPtrTailNext := mPtrTail`,
      ` `,
      `/// Copy elements to memory`,
      `/// Calldata does not have individual offsets for array elements with a fixed size.`,
      `calldatacopy(`,
      [`mPtrTail,`, `${copyStartExpression},`, tailSizeExpression],
      `)`,
      "let mPtrHeadNext := mPtrHead",
      ` `,
      `for {} lt(mPtrHeadNext, mPtrTail) {} {`,
      `  mstore(mPtrHeadNext, mPtrTailNext)`,
      `  mPtrHeadNext := add(mPtrHeadNext, 0x20)`,
      `  mPtrTailNext := add(mPtrTailNext, ${tailSizeName})`,
      `}`,
      `mstore(0x40, mPtrTailNext)`
    );

    return this.addDecoderFunction(type, inPtr, outPtr, [`assembly {`, body, `}`]);
  }

  /**
   * Generates an ABI decoding function for an array of value types.
   */
  decodeValueArray(type: ArrayType): string {
    assert(
      type.baseType.isValueType,
      `Array with non-value baseType ${type.baseType.identifier} passed to decodeValueArray`
    );
    let inPtr = "cdPtrLength";
    let outPtr = "mPtrLength";
    const body: StructuredText[] = [];
    if (type.isDynamicallySized) {
      body.push(
        `unchecked {`,
        [
          `uint256 arrLength = cdPtrLength.readMaskedUint256();`,
          `uint256 arrSize = (arrLength + 1) * 32;`,
          `mPtrLength = malloc(arrSize);`,
          `cdPtrLength.copy(mPtrLength, arrSize);`
        ],
        `}`
      );
    } else {
      inPtr = "cdPtr";
      outPtr = "mPtr";
      const sizeName = this.getConstant("tailSize", (type.length as number) * 32, type);
      body.push(`mPtr = malloc(${sizeName});`);
      body.push(`cdPtr.copy(mPtr, ${sizeName});`);
    }
    return this.addDecoderFunction(type, inPtr, outPtr, body);
  }

  /**
   * Generates an ABI decoding function for an array of reference types which can not
   * be combined into a single copy, i.e. those with embedded reference types.
   */
  decodeArraySeparateTail(type: ArrayType): string {
    let inPtr = "cdPtrLength";
    let outPtr = "mPtrLength";
    const body: StructuredText[] = [];
    let tailOffset = "tailOffset";
    const decodeFn = this.visit(type.baseType);
    const cdPtrItem = type.baseType.isDynamicallyEncoded
      ? `cdPtrHead.pptr(offset)`
      : `cdPtrHead.offset(offset)`;

    if (type.isDynamicallySized) {
      body.push(
        `unchecked {`,
        [
          `uint256 arrLength = cdPtrLength.readUint256();`,
          `uint256 tailOffset = arrLength * 32;`,
          `mPtrLength = malloc(tailOffset + 32);`,
          `mPtrLength.write(arrLength);`,
          `MemoryPointer mPtrHead = mPtrLength.next();`,
          `CalldataPointer cdPtrHead = cdPtrLength.next();`,
          ``,
          `for (uint256 offset; offset < tailOffset; offset += 32) {`,
          [`mPtrHead.offset(offset).write(${decodeFn}(${cdPtrItem}));`],
          `}`
        ],
        `}`
      );
    } else {
      inPtr = "cdPtrHead";
      outPtr = "mPtrHead";
      const headSize = this.getConstant(
        `headSize`,
        toHex(type.embeddedMemoryHeadSize),
        type,
        EncodingScheme.SolidityMemory
      );
      tailOffset = headSize;
      body.push(
        `mPtrHead = malloc(${tailOffset});`,
        ``,
        `for (uint256 offset; offset < ${tailOffset}; offset += 32) {`,
        [`mPtrHead.offset(offset).write(${decodeFn}(${cdPtrItem}));`],
        `}`
      );
    }

    return this.addDecoderFunction(type, inPtr, outPtr, body);
  }
}
