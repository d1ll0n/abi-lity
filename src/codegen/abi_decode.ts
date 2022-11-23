import { DataLocation, FunctionDefinition, SourceUnit } from "solc-typed-ast";
import { abiDecodingFunctionArray } from "./abi_decode_array";
import { DecoderContext, roundUpAdd32 } from "./utils";
import { ArrayType, BytesType, StructType, TupleType, TypeNode } from "../ast";
import { functionDefinitionToTypeNode } from "../readers/read_solc_ast";
import {
  StructuredText,
  toHex,
  writeNestedStructure,
  addDependencyImports,
  getConstant
} from "../utils";

function abiDecodingFunctionStruct(ctx: DecoderContext, struct: StructType): string {
  const inner: string[] = [
    `mPtr := mload(0x40)`,
    `mstore(0x40, add(mPtr, ${toHex(struct.embeddedMemoryHeadSize)}))`
  ];
  for (const member of struct.vMembers) {
    const headPositionSrc = struct.calldataOffsetOfChild(member);
    const headPositionDst = struct.memoryOffsetOfChild(member);
    const dst = headPositionDst === 0 ? "mPtr" : `add(mPtr, ${headPositionDst})`;
    let src = headPositionSrc === 0 ? "cdPtr" : `add(cdPtr, ${headPositionSrc})`;
    if (member.isValueType) {
      inner.push(`calldatacopy(${dst}, ${src}, 32)`);
    } else {
      const decodeFn = abiDecodingFunction(ctx, member);
      if (member.isDynamicallyEncoded) {
        inner.push(`let ${member.labelFromParent}CdPtr := add(cdPtr, calldataload(${src}))`);
        src = `${member.labelFromParent}CdPtr`;
      }
      inner.push(`mstore(${dst}, ${decodeFn}(${src}))`);
    }
  }
  const fnName = `abi_decode_${struct.identifier}`;
  const code = [`function ${fnName}(cdPtr) -> mPtr {`, inner, "}"];
  ctx.addFunction(fnName, code);
  return fnName;
}

function abiDecodingFunctionBytes(ctx: DecoderContext): string {
  const fnName = `abi_decode_bytes`;
  if (ctx.hasFunction(fnName)) return fnName;
  const code = [
    `function abi_decode_bytes(cdPtrLength) -> mPtrLength {`,
    [
      `mPtrLength := mload(0x40)`,
      `let size := ${roundUpAdd32(ctx, "calldataload(cdPtrLength)")}`,
      `calldatacopy(mPtrLength, cdPtrLength, size)`,
      `mstore(0x40, add(mPtrLength, size))`
    ],
    "}"
  ];
  ctx.addFunction(fnName, code);
  return fnName;
}

export function abiDecodingFunction(ctx: DecoderContext, node: TypeNode): string {
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

export function getDecoderForFunction(
  fn: FunctionDefinition,
  coderSourceUnit: SourceUnit
): { code: string; name: string } {
  addDependencyImports(coderSourceUnit, fn);
  const type = functionDefinitionToTypeNode(fn);
  if (!type.parameters) throw Error(`Can not decode function without parameters`);
  const ctx = new DecoderContext();
  const decoderFn = getDecodeParametersTuple(ctx, type.parameters);
  for (const constantName of [...ctx.constants.keys()]) {
    getConstant(
      coderSourceUnit,
      constantName,
      ctx.constants
        .get(constantName)
        ?.replace(`uint256 constant ${constantName} = `, "")
        .replace(";", "") as string
    );
  }
  return decoderFn;
}

function getDecodeParametersTuple(ctx: DecoderContext, type: TupleType) {
  const typeName = type.vMembers.length > 1 ? type.identifier : type.vMembers[0].identifier;
  const fnName = `abi_decode_${typeName}`;
  if (ctx.hasFunction(fnName)) {
    return { name: fnName, code: ctx.functions.get(fnName) as string };
  }
  const inner: StructuredText = [];
  for (const member of type.vMembers) {
    const headPositionSrc = 4 + type.calldataOffsetOfChild(member);
    const name = member.labelFromParent;
    if (!name) throw Error(`Tuple member not named: ${type.identifier} -> ${member.identifier}`);
    const decodeFn = member.isValueType ? `calldataload` : abiDecodingFunction(ctx, member);
    inner.push(`${name} := ${decodeFn}(${headPositionSrc})`);
  }
  const asmFunctions = [...ctx.functions.values()];

  // [`assembly {`, [...asmFunctions, `ret := ${decodeFn}(${ref})`], `}`],
  const code = writeNestedStructure([
    `function ${fnName}() pure returns ${type.writeParameter(DataLocation.Memory)} {`,
    [`assembly {`, [...asmFunctions, inner], `}`],
    `}`
  ]);
  return { code, name: fnName };
  /*   const fn = staticNodeFactory.makeFunctionDefinition(
    sourceUnit.requiredContext,
    sourceUnit.id,
    FunctionKind.Function,
    fnName,
    false,
    FunctionVisibility.Default,
    FunctionStateMutability.Pure,
    false,
    staticNodeFactory.makeParameterList(sourceUnit.requiredContext, []),
    staticNodeFactory.makeParameterList(sourceUnit.requiredContext, []),
    []
  );
  const deps = extrac
  sourceUnit.requiredContext.nodes.
  const code = writeNestedStructure([]); */
}
