import { DataLocation, FunctionStateMutability, assert, coerceArray } from "solc-typed-ast";
import {
  ArrayType,
  BytesType,
  DefaultVisitor,
  ErrorType,
  EventType,
  FunctionType,
  StructType,
  TupleType,
  TypeNode,
  UABIType,
  ValueType
} from "../../../ast";
import { StructuredText, toHex } from "../../../utils";
import NameGen, { NameGenKey, NameGenParameters, NameGenTypeParams } from "../../names";
import { EncodingScheme } from "../../../constants";
import { getMemberDataOffset, getMemberHeadOffset } from "../../offsets";
import { typeCastFunction } from "./type_cast";
import { WrappedScope } from "../../ctx/contract_wrapper";
import { abiEncodeBytes } from "../templates/templates";

export const VisitorByScope: WeakMap<WrappedScope, AbiEncodeVisitor> = new Map();

export function abiEncodingFunction(ctx: WrappedScope, type: TypeNode): string {
  const visitor = AbiEncodeVisitor.getVisitor(ctx);
  return visitor.accept(type);
}

// type EncodeTypeGenerator = (...paramReferences: string[]) =>

/**
 * This visitor generates code for encoding a type into ABI format.
 * With the exception of value types and tuples, every type generates its own encoder
 * function with the signature:
 *
 * `abi_encode_<type_name>(MemoryPointer src, MemoryPointer dst) returns (uint256 size)`
 * where:
 *  - `src` is the memory location where the data is stored (in solc memory layout)
 *  - `dst` is the memory location where the encoded data should be stored (in ABI layout)
 *  - `size` is the size of the encoded data in bytes
 *
 * Exceptions:
 * - Tuple types take a list of memory pointers rather than a single one.
 * - @todo Tuples of value types are encoded inline and do not require a separate function.
 *     - Only applies when `getEncodeTuple` function is used.
 * - Value types are encoded inline and do not require a separate function.
 *
 * @note The generated functions do not allocate any memory. This is done where necessary
 * by other generated code that calls these functions. This is done to avoid expanding
 * memory with data that is only used once, e.g. a hash digest, returndata, etc.
 */
export class AbiEncodeVisitor extends DefaultVisitor {
  existingTypeFunctions: Map<string, string> = new Map();

  constructor(private ctx: WrappedScope) {
    super();
    VisitorByScope.set(ctx, this);
  }

  static getVisitor(ctx: WrappedScope): AbiEncodeVisitor {
    let visitor = VisitorByScope.get(ctx);
    if (!visitor) {
      visitor = new AbiEncodeVisitor(ctx);
    }
    return visitor;
  }

  protected _shouldSkipVisitWith(type: TypeNode): string | undefined {
    return this.existingTypeFunctions.get(type.identifier);
  }

  get defaultReturnValue(): any {
    throw new Error("No default encoder.");
  }

  protected _afterVisit<T extends UABIType>(_type: T, result: any): string {
    this.existingTypeFunctions.set(_type.identifier, result);
    return result;
  }

  protected _memberHeadOffset(member: TypeNode, encoding: EncodingScheme): string {
    return getMemberHeadOffset(
      this.ctx,
      encoding === EncodingScheme.SolidityMemory ? "src" : "dst",
      member,
      encoding
    );
  }

  protected _memberDataOffset(member: TypeNode, encoding: EncodingScheme): string {
    return getMemberDataOffset(
      this.ctx,
      encoding === EncodingScheme.SolidityMemory ? "src" : "dst",
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

  addEncoderFunction(
    type: TypeNode,
    inputParams: string | string[],
    body: StructuredText,
    comment?: StructuredText,
    leaveParams?: boolean
  ): string {
    inputParams = leaveParams
      ? coerceArray(inputParams).join(", ")
      : coerceArray(inputParams)
          .map((p) => `MemoryPointer ${p}`)
          .join(", ");
    return this.ctx.addInternalFunction(
      NameGen.innerAbiEncode(type),
      inputParams,
      `uint256 size`,
      body,
      FunctionStateMutability.Pure,
      comment
    );
  }

  visitBytes(type: BytesType): string {
    const { comment, code } = abiEncodeBytes;
    return this.addEncoderFunction(type, ["src", "dst"], code, comment);
  }

  visitFunctionOrError(type: FunctionType | ErrorType): string {
    const tuple = type.parameters;
    const sizeName = NameGen.parameterHeadSize(type, false);
    const selectorValue = type instanceof FunctionType ? type.functionSelector : type.errorSelector;
    const selector = this.getConstant("selector", selectorValue.padEnd(66, "0"), type);
    const body: StructuredText[] = [`dst.write(${selector});`];

    if (tuple) {
      if (tuple.vMembers.every((m) => m.isValueType) && tuple.vMembers.length === 1) {
        this.ctx.addConstant(sizeName, toHex(tuple.embeddedCalldataHeadSize) + 4);
        body.push(`size = ${sizeName};`);
        const member = tuple.vMembers[0];
        body.push(
          `/// Write ${member.labelFromParent}`,
          `dst.offset(4).write(${member.labelFromParent});`
        );
      } else {
        const encodeParams = [
          "dst.offset(4)",
          ...tuple.vMembers.map((member) => member.labelFromParent)
        ].join(", ");
        const encodeFn = this.visit(tuple);
        body.push(`/// Encode parameters`, `size = 4 + ${encodeFn}(${encodeParams});`);
      }
    } else {
      body.push(`size = 4;`);
    }

    const outerParameters = [
      `MemoryPointer dst`,
      ...(tuple ? tuple.vMembers.map((member) => member.writeParameter(DataLocation.Memory)) : [])
    ];

    return this.addEncoderFunction(type, outerParameters, body, undefined, true);
  }

  visitFunction(type: FunctionType): string {
    return this.visitFunctionOrError(type);
  }

  visitError(type: ErrorType): string {
    return this.visitFunctionOrError(type);
  }

  // visitEvent(type: EventType): string {}

  /// @todo add ability to return a fn that takes the parameter name
  /// and returns an expression to do the encoding (inline or fn call)
  visitValueType(type: ValueType): string {
    const body = [`dst.copyWord(src);`, `size = 32;`];
    return this.addEncoderFunction(type, ["src", "dst"], body);
  }

  visitTuple(tuple: TupleType): string {
    const shouldUnwrap = tuple.vMembers.length === 1 && !tuple.vMembers[0].isDynamicallyEncoded;
    // Tuple encoding functions are different from other encoding functions in that
    // they take dst as the first value, followed by the tuple components, whereas
    // other encoding functions take src as the first pointer, followed by dst.
    const innerParametersSignature = [
      `MemoryPointer`,
      ...tuple.vMembers.map(() => `MemoryPointer`)
    ].join(", ");

    const outerParametersSignature = [
      ...(shouldUnwrap ? [] : [`MemoryPointer`]),
      ...tuple.vMembers.map((member) => member.writeParameter(DataLocation.Memory, "")),
      ...(shouldUnwrap ? [`MemoryPointer`] : [])
    ].join(", ");

    const castFnName = typeCastFunction(
      this.ctx,
      tuple,
      innerParametersSignature,
      `uint256`,
      outerParametersSignature,
      "uint256"
    );
    if (tuple.vMembers.length === 1 && !tuple.vMembers[0].isDynamicallyEncoded) {
      const fnName = this.visit(tuple.vMembers[0]);
      return `${castFnName}(${fnName})`;
    }

    const sizeName = this.getConstant(
      "headSize",
      toHex(tuple.embeddedCalldataHeadSize),
      tuple,
      EncodingScheme.ABI
    );
    const body: StructuredText[] = [`size = ${sizeName};`];

    tuple.vMembers.forEach((member, i) => {
      const src = member.labelFromParent ?? `value${i}`;
      const dst = this._memberHeadOffset(member, EncodingScheme.ABI);
      if (member.isValueType) {
        body.push(`/// Copy ${member.labelFromParent}`, `${dst}.write(${src});`);
      } else if (member.isDynamicallyEncoded) {
        const encodeFn = this.visit(member);
        body.push(
          `/// Write offset to ${member.labelFromParent} in head`,
          `${dst}.write(size);`,
          `/// Encode ${member.labelFromParent}`,
          `size += ${encodeFn}(${src}, dst.offset(size));`
        );
      } else {
        // Reference type that is not dynamically encoded - encoded in place
        const encodeFn = this.visit(member);
        body.push(
          `/// Encode ${member.labelFromParent} in place in the head`,
          `${encodeFn}(${src}, ${dst});`
        );
      }
    });

    const parameters = [
      `dst`,
      ...tuple.vMembers.map((member, i) => `${member.labelFromParent ?? `value${i}`}`)
    ];
    const fnName = this.addEncoderFunction(tuple, parameters, body);
    return `${castFnName}(${fnName})`;
  }

  visitStruct(struct: StructType): string {
    const sizeName = this.getConstant("headSize", toHex(struct.embeddedCalldataHeadSize), struct);

    const body: StructuredText[] = [`size = ${sizeName};`];

    for (const member of struct.vMembers) {
      const src = this._memberDataOffset(member, EncodingScheme.SolidityMemory);
      const dst = this._memberHeadOffset(member, EncodingScheme.ABI);
      if (member.isValueType) {
        body.push(`/// Copy ${member.labelFromParent}`, `${dst}.write(${src}.readUint256());`);
      } else if (member.isDynamicallyEncoded) {
        const encodeFn = this.visit(member);
        body.push(
          `/// Write offset to ${member.labelFromParent} in head`,
          `${dst}.write(size);`,
          `/// Encode ${member.labelFromParent}`,
          `size += ${encodeFn}(${src}, dst.offset(size));`
        );
      } else {
        // Reference type that is not dynamically encoded - encoded in place
        const encodeFn = this.visit(member);
        body.push(
          `/// Encode ${member.labelFromParent} in place in the head`,
          `${encodeFn}(${src}, ${dst});`
        );
      }
    }

    return this.addEncoderFunction(struct, ["src", "dst"], body);
  }

  visitArray(type: ArrayType): string {
    if (type.baseType.isValueType) {
      return this.encodeValueArray(type);
    }
    if (type.baseType.isDynamicallyEncoded) {
      return this.encodeArraySeparateTail(type);
    }
    return this.encodeArrayCombinedStaticTail(type);
  }

  /**
   * Generates an ABI encoding function for an array of fixed-size reference types
   * that can be combined into a single copy (no embedded reference types).
   */
  encodeArrayCombinedStaticTail(type: ArrayType): string {
    const tailSizeName =
      type.baseType.memoryDataSize === 32
        ? "OneWord"
        : this.getConstant(
            "tailSize",
            toHex(type.baseType.memoryDataSize as number),
            type.baseType,
            EncodingScheme.SolidityMemory
          );

    const body: StructuredText[] = [];
    let inPtr = "srcLength";
    let outPtr = "dstLength";
    let setSizeStatement: StructuredText[] = [
      `unchecked {`,
      [`size = OneWord + (length * ${tailSizeName});`],
      `}`
    ];

    if (type.isDynamicallySized) {
      body.push(
        `/// Read length of the array from source and write to destination.`,
        `uint256 length = srcLength.readUint256();`,
        `dstLength.write(length);`,
        "",
        `/// Get pointer to first item's head position in the array, containing`,
        `/// the item's pointer in memory. The head pointer will be incremented`,
        `/// until it reaches the tail position (start of the array data).`,
        `MemoryPointer srcHead = srcLength.next();`,
        `MemoryPointer srcHeadEnd = srcHead.offset(length * OneWord);`,
        "",
        `/// Position in memory to write next item. Since ${type.baseType.identifier} has`,
        `/// a fixed size, the array elements do not contain offsets when ABI`,
        `/// encoded, they are concatenated together after the array length.`,
        `MemoryPointer dstHead = dstLength.next();`
      );
    } else {
      inPtr = "srcHead";
      outPtr = "dstHead";
      body.push(
        `MemoryPointer srcHeadEnd = srcHead.offset(${toHex(32 * (type.length as number))});`
      );
      const encodedSizeExpression = this.getConstant(
        "encodedSize",
        toHex(type.calldataEncodedSize as number),
        type
      );
      setSizeStatement = [`size = ${encodedSizeExpression};`];
    }
    body.push(
      `while (srcHead.lt(srcHeadEnd)) {`,
      [
        `MemoryPointer srcTail = srcHead.pptr();`,
        `srcTail.copy(dstHead, ${tailSizeName});`,
        `srcHead = srcHead.next();`,
        `dstHead = dstHead.offset(${tailSizeName});`
      ],
      `}`,
      ...setSizeStatement
    );

    return this.addEncoderFunction(type, [inPtr, outPtr], body);
  }

  /**
   * Generates an ABI encoding function for an array of value types.
   */
  encodeValueArray(type: ArrayType): string {
    assert(
      type.baseType.isValueType,
      `Can not make value-array encoding function for array of ${type.baseType.identifier}`
    );
    const body: StructuredText[] = [];
    let inPtr = "srcLength";
    let outPtr = "dstLength";
    if (type.isDynamicallySized) {
      body.push(
        `uint256 length = srcLength.readUint256();`,
        `unchecked {`,
        [`size = (length + 1) << OneWordShift;`],
        `}`
      );
    } else {
      inPtr = "src";
      outPtr = "dst";
      const headSize = this.getConstant(
        "headSize",
        toHex(type.calldataHeadSize),
        type,
        EncodingScheme.ABI
      );
      body.push(`size = ${headSize};`);
    }
    body.push(`${inPtr}.copy(${outPtr}, size);`);
    return this.addEncoderFunction(type, [inPtr, outPtr], body);
  }

  /**
   * Generates an ABI encoding function for an array of reference types which can not
   * be combined into a single copy, i.e. those with embedded reference types.
   */
  encodeArraySeparateTail(type: ArrayType): string {
    let inPtr = "srcLength";
    let outPtr = "dstLength";
    const body: StructuredText[] = [];
    const encodeFn = this.visit(type.baseType);

    if (type.isDynamicallySized) {
      body.push(
        `unchecked {`,
        [
          `/// Read length of the array from source and write to destination.`,
          `uint256 length = srcLength.readUint256();`,
          `dstLength.write(length);`,
          "",
          `/// Get pointer to head of first element, which contains a pointer to its data.`,
          `MemoryPointer srcHead = srcLength.next();`,
          "",
          `/// Position in memory to write next item's offset. Since ${type.baseType.identifier} has`,
          `/// a dynamic size, the array elements contain offsets relative to the start of the head.`,
          `MemoryPointer dstHead = dstLength.next();`,
          "",
          `uint256 headOffset;`,
          `uint256 headSize = length << OneWordShift;`,
          `size = headSize;`,
          "",
          `while (headOffset < headSize) {`,
          [
            `/// Write tail offset to the array head.`,
            `dstHead.offset(headOffset).write(size);`,
            "",
            `/// Encode the item into the array tail and get its encoded size.`,
            `uint256 itemSize = ${encodeFn}(srcHead.pptr(headOffset), dstHead.offset(size));`,
            "",
            `/// Update total size of the array and the head offset for the next item.`,
            `size += itemSize;`,
            `headOffset += OneWord;`
          ],
          `}`,
          `size += 32;`
        ],
        `}`
      );
    } else {
      inPtr = "srcHead";
      outPtr = "dstHead";
      const headSize = this.getConstant(
        "headSize",
        toHex(type.embeddedMemoryHeadSize),
        type,
        EncodingScheme.SolidityMemory
      );
      body.push(
        `uint256 headOffset;`,
        `size = ${headSize};`,
        "",
        `while (headOffset < ${headSize}) {`,
        [
          `/// Write tail offset to the array head.`,
          `dstHead.offset(headOffset).write(size);`,
          "",
          `/// Encode the item into the array tail and add its encoded size to total size.`,
          `size += ${encodeFn}(srcHead.pptr(headOffset), dstHead.offset(size));`,
          "",
          `/// Update head offset for the next item.`,
          `headOffset += OneWord;`
        ],
        `}`
      );
    }

    return this.addEncoderFunction(type, [inPtr, outPtr], body);
  }
}
