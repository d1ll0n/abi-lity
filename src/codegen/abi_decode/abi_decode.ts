import { FunctionDefinition } from "solc-typed-ast";
import { abiDecodingFunctionArray } from "./abi_decode_array";
import { ArrayType, BytesType, StructType, TupleType, TypeNode } from "../../ast";
import { functionDefinitionToTypeNode } from "../../readers/read_solc_ast";
import { StructuredText, toHex, writeNestedStructure, addDependencyImports } from "../../utils";
import {
  CodegenContext,
  getCalldataDecodingFunction,
  getSequentiallyCopyableSegments
} from "../utils";
import NameGen from "../names";
import { EncodingScheme } from "../../constants";
import { getMemberDataOffset, getMemberHeadOffset, getOffsetExpression } from "../offsets";

function abiDecodingFunctionStruct(ctx: CodegenContext, struct: StructType): string {
  const sizeName = `${struct.identifier}_head_size`;
  ctx.addConstant(sizeName, toHex(struct.embeddedMemoryHeadSize));
  const body: StructuredText[] = [`mPtr = malloc(${sizeName});`];
  const segments = getSequentiallyCopyableSegments(struct);
  segments.forEach((segment, i) => {
    let size = toHex(segment.length * 32);
    if (segments.length === 1 && segment.length === struct.vMembers.length) {
      size = sizeName;
    } else if (segment.length === 1) {
      if (segment[0].isValueType) {
        const name = `OneWord`;
        size = ctx.addConstant(name, "0x20");
      } else {
        const name = NameGen.structMemberSize(segment[0]);
        size = ctx.addConstant(name, size);
      }
    } else {
      const name = `${struct.identifier}_fixed_segment_${i}`;
      size = ctx.addConstant(name, size);
    }
    const src = getMemberDataOffset(ctx, "cdPtr", segment[0], EncodingScheme.ABI);
    const dst = getMemberHeadOffset(ctx, "mPtr", segment[0], EncodingScheme.SolidityMemory);

    body.push(
      `// Copy ${segment.map((s) => s.labelFromParent).join(", ")}`,
      `${src}.copy(${dst}, ${size});`
    );
  });

  const referenceTypes = struct.vMembers.filter((type) => type.isReferenceType);
  for (const member of referenceTypes) {
    const src = getMemberDataOffset(ctx, "cdPtr", member, EncodingScheme.ABI);
    const dst = getMemberHeadOffset(ctx, "mPtr", member, EncodingScheme.SolidityMemory);
    const decodeFn = abiDecodingFunction(ctx, member);
    body.push(`${dst}.write(${decodeFn}(${src}));`);
  }

  const fnName = `abi_decode_${struct.identifier}`;
  const code = getCalldataDecodingFunction(fnName, "cdPtr", "mPtr", body);
  ctx.addFunction(fnName, code);
  return fnName;
}

function abiDecodingFunctionBytes(ctx: CodegenContext): string {
  const fnName = `abi_decode_bytes`;
  if (ctx.hasFunction(fnName)) return fnName;

  const code = getCalldataDecodingFunction(fnName, `cdPtrLength`, `mPtrLength`, [
    `assembly {`,
    [
      `/// Get the current free memory pointer.`,
      `mPtrLength := mload(_FreeMemoryPointerSlot)`,

      `/// Derive the size of the bytes array, rounding up to nearest word`,
      `/// and adding a word for the length field. Note: masking`,
      `/// \`calldataload(cdPtrLength)\` is redundant here.`,
      `let size := add(`,
      [
        `and(`,
        [`add(calldataload(cdPtrLength), ThirtyOneBytes),`, `OnlyFullWordMask`],
        `),`,
        `OneWord`
      ],
      `)`,

      `/// Copy bytes from calldata into memory based on pointers and size.`,
      `calldatacopy(mPtrLength, cdPtrLength, size)`,

      `/// Store the masked value in memory. Note: the value of \`size\` is at`,
      `/// least 32, meaning the calldatacopy above will at least write to`,
      `/// \`[mPtrLength, mPtrLength + 32)\`.`,
      `mstore(`,
      [`mPtrLength,`, `and(calldataload(cdPtrLength), OffsetOrLengthMask)`],
      `)`,
      `/// Update free memory pointer based on the size of the bytes array.`,
      `mstore(_FreeMemoryPointerSlot, add(mPtrLength, size))`
    ],
    `}`
  ]);
  ctx.addFunction(fnName, code);
  return fnName;
}

export function abiDecodingFunction(ctx: CodegenContext, node: TypeNode): string {
  if (node instanceof ArrayType) {
    return abiDecodingFunctionArray(ctx, node);
  }
  if (node instanceof BytesType) {
    return abiDecodingFunctionBytes(ctx);
  }
  if (node instanceof StructType) {
    return abiDecodingFunctionStruct(ctx, node);
  }
  throw Error(`Unsupported type: ${node.identifier}`);
}

export function getDecoderForFunction(ctx: CodegenContext, fn: FunctionDefinition): string {
  addDependencyImports(ctx.decoderSourceUnit, fn);
  const type = functionDefinitionToTypeNode(fn);
  if (!type.parameters) throw Error(`Can not decode function without parameters`);
  const decoderFn = getDecodeParametersTuple(ctx, type.parameters);
  return decoderFn;
}

function getDecodeParametersTuple(ctx: CodegenContext, type: TupleType) {
  const decodeType = type.vMembers.length > 1 ? type : type.vMembers[0];
  const fnName = NameGen.abiDecode(decodeType);
  if (ctx.hasFunction(fnName)) return fnName;
  const returnParameters = type.vMembers
    .map((node, i) => `MemoryPointer ${node.labelFromParent ?? `value${i}`}`)
    .join(", ");
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
      inner.push(`${name} = ${abiDecodingFunction(ctx, member)}(${src});`);
    }
  });

  const code = writeNestedStructure([
    `function ${fnName}() pure returns (${returnParameters}) {`,
    inner,
    `}`
  ]);
  ctx.addFunction(fnName, code);
  return fnName;
}
