import { DataLocation, FunctionDefinition } from "solc-typed-ast";
import { abiDecodingFunctionArray } from "./abi_decode_array";
import { ArrayType, BytesType, StructType, TupleType, TypeNode } from "../../ast";
import { functionDefinitionToTypeNode } from "../../readers/read_solc_ast";
import { StructuredText, toHex, writeNestedStructure, addDependencyImports } from "../../utils";
import {
  CodegenContext,
  getCalldataDecodingFunction,
  getSequentiallyCopyableSegments,
  roundUpAdd32
} from "../utils";
import NameGen from "../names";

function getOffset(parent: string, offset: number | string, pptr?: boolean): string {
  const offsetString = typeof offset === "number" ? toHex(offset) : offset;
  if (pptr) {
    return `${parent}.pptr(${offset === 0 ? "" : offsetString})`;
  }
  return offset === 0 ? parent : `${parent}.offset(${offsetString})`;
}

function getMemberOffset(ctx: CodegenContext, type: TypeNode, location: DataLocation) {
  const name = NameGen.structMemberOffset(type, location);
  const offset =
    location === DataLocation.CallData ? type.calldataHeadOffset : type.memoryHeadOffset;
  const offsetString = offset === 0 ? "" : ctx.addConstant(name, toHex(offset));
  const parentString = location === DataLocation.CallData ? "cdPtr" : "mPtr";
  if (type.isDynamicallyEncoded && location === DataLocation.CallData) {
    return `${parentString}.pptr(${offsetString})`;
  }
  return offsetString ? `${parentString}.offset(${offsetString})` : parentString;
}

function abiDecodingFunctionStruct(ctx: CodegenContext, struct: StructType): string {
  const sizeName = `${struct.identifier}_head_size`;
  ctx.addConstant(sizeName, toHex(struct.embeddedMemoryHeadSize));
  const body: StructuredText[] = [`mPtr = malloc(${sizeName});`];
  const segments = getSequentiallyCopyableSegments(struct);
  segments.forEach((segment, i) => {
    let size = toHex(segment.length * 32);
    if (segments.length === 1 && segment.length === struct.vMembers.length) {
      size = sizeName;
    } else {
      const name = `${struct.identifier}_fixed_segment_${i}`;
      size = ctx.addConstant(name, size);
    }
    const src = getMemberOffset(ctx, segment[0], DataLocation.CallData);
    const dst = getMemberOffset(ctx, segment[0], DataLocation.Memory);

    body.push(
      `// Copy ${segment.map((s) => s.labelFromParent).join(", ")}`,
      `${src}.copy(${dst}, ${size});`
    );
  });

  const referenceTypes = struct.vMembers.filter((type) => type.isReferenceType);
  for (const member of referenceTypes) {
    const src = getMemberOffset(ctx, member, DataLocation.CallData);
    const dst = getMemberOffset(ctx, member, DataLocation.Memory);
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
      `mPtrLength := mload(0x40)`,
      `let size := ${roundUpAdd32(ctx, "calldataload(cdPtrLength)")}`,
      `calldatacopy(mPtrLength, cdPtrLength, size)`,
      `mstore(0x40, add(mPtrLength, size))`
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
    // const headPositionSrc = 4 + type.calldataOffsetOfChild(member);
    const src = getOffset(
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
