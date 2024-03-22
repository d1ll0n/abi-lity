import { DataLocation, FunctionStateMutability, Mapping, StructDefinition } from "solc-typed-ast";
import {
  ArrayType,
  ContractType,
  EnumType,
  FixedBytesType,
  IntegerType,
  StructType,
  TypeNode,
  ValueType
} from "../../../../ast";
import {
  addCommaSeparators,
  coerceArray,
  Logger,
  NoopLogger,
  StructuredText
} from "../../../../utils";
import { WrappedScope, WrappedSourceUnit } from "../../../../codegen/ctx/contract_wrapper";
import { CompileHelper } from "../../../../utils/compile_utils/compile_helper";
import { getLibJson } from "../../../../codegen/solidity_libraries";
import { structDefinitionToTypeNode } from "../../../../readers";

const builtinSerializers = {
  bool: "serializeBool",
  uint256: "serializeUint256",
  int256: "serializeInt256",
  address: "serializeAddress",
  bytes32: "serializeBytes32",
  string: "serializeString",
  bytes: "serializeBytes",
  "bool[]": "serializeBoolArray",
  "uint256[]": "serializeUint256Array",
  "int256[]": "serializeInt256Array",
  "address[]": "serializeAddressArray",
  "bytes32[]": "serializeBytes32Array",
  "string[]": "serializeStringArray"
} as Record<string, string>;

export type CoderOptions = {
  decoderFileName?: string;
  outPath?: string;
};

export function generateJsonSerializers(
  helper: CompileHelper,
  fileName: string,
  options: CoderOptions = {},
  struct?: string | string[],
  logger: Logger = new NoopLogger()
): void {
  const serializerFileName = options.decoderFileName ?? fileName.replace(".sol", "Serializers.sol");
  const ctx: WrappedScope = WrappedSourceUnit.getWrapper(
    helper,
    serializerFileName,
    options.outPath
  );
  const sourceUnit = helper.getSourceUnit(fileName);
  const libJson = ctx.addSourceUnit("LibJson.sol", getLibJson());
  ctx.addImports(sourceUnit);
  ctx.addImports(libJson);
  let structDefinitions = sourceUnit
    .getChildrenByType(StructDefinition)
    .filter((struct) => struct.getChildrenByType(Mapping).length === 0);
  if (struct) {
    structDefinitions = structDefinitions.filter((s) => coerceArray(struct).includes(s.name));
  }

  const structs = structDefinitions.map(structDefinitionToTypeNode);
  for (const struct of structs) {
    getForgeJsonSerializeFunction(ctx, struct);
  }
  ctx.applyPendingFunctions();
}

export function getForgeJsonSerializeFunction(ctx: WrappedScope, type: TypeNode): string {
  const baseSignature = type.signatureInExternalFunction(true);
  const builtinName = builtinSerializers[baseSignature];
  if (builtinName) {
    const body = [`return LibJson.${builtinName}(value);`];
    return addSerializeFunction(ctx, type, body);
  }
  if (type instanceof ArrayType) {
    return getForgeSerializeArrayFunction(ctx, type);
  }
  if (type instanceof StructType) {
    return getForgeSerializeStructFunction(ctx, type);
  }
  if (type instanceof EnumType) {
    return getForgeSerializeEnumFunction(ctx, type);
  }
  if (type instanceof ValueType) {
    if (baseSignature.startsWith("int") || baseSignature.startsWith("uint")) {
      return getForgeJsonSerializeFunction(
        ctx,
        new IntegerType(256, baseSignature.startsWith("i"))
      );
    }
    if (baseSignature.startsWith("bytes")) {
      return getForgeJsonSerializeFunction(ctx, new FixedBytesType(32));
    }
  }
  throw Error(`Could not make serializer for type: ${type.pp()}`);
}

export function getForgeSerializeEnumFunction(ctx: WrappedScope, type: EnumType): string {
  const body: StructuredText<string> = [
    `string[${type.members.length}] memory members = [`,
    addCommaSeparators(type.members.map((m) => `"${m}"`)),
    "];",
    `uint256 index = uint256(value);`,
    `return members[index];`
  ];
  return addSerializeFunction(ctx, type, body);
}

function addSerializeFunction(ctx: WrappedScope, type: TypeNode, body: StructuredText<string>) {
  const name = `serialize${type.pascalCaseName}`;
  const inputs = `${type.writeParameter(DataLocation.Memory, "value")}`;
  const outputs = "string memory";
  const fn = ctx.addInternalFunction(name, inputs, outputs, body, FunctionStateMutability.Pure);
  const prefix = type.isReferenceType ? `` : "LibJson.";
  return `${prefix}${fn}`;
}

export function getForgeSerializeArrayFunction(ctx: WrappedScope, type: ArrayType): string {
  const baseSerialize = getForgeJsonSerializeFunction(ctx, type.baseType);
  const baseArg = type.baseType.writeParameter(DataLocation.Memory, "");
  const body: StructuredText[] = [
    `function(uint256[] memory, function(uint256) pure returns (string memory)) internal pure returns (string memory) _fn = LibJson.serializeArray;`,
    `function(${type.writeParameter(
      DataLocation.Memory,
      ""
    )}, function(${baseArg}) pure returns (string memory)) internal pure returns (string memory) fn;`,
    `assembly { fn := _fn }`,
    `return fn(value, ${baseSerialize});`
  ];
  return addSerializeFunction(ctx, type, body);
}

export function getForgeSerializeStructFunction(ctx: WrappedScope, struct: StructType): string {
  const segments: StructuredText[] = [];
  struct.children.forEach((child, i) => {
    const fn = getForgeJsonSerializeFunction(ctx, child);
    let ref = `value.${child.labelFromParent}`;
    if (child instanceof ContractType) {
      ref = `address(${ref})`;
    }
    const prefix = i === 0 ? "{" : ",";
    segments.push(`'${prefix}"${child.labelFromParent}":'`);
    segments.push(`${fn}(${ref})`);
  });
  segments.push("'}'");
  return addSerializeFunction(ctx, struct, [`return string.concat(`, segments.join(","), `);`]);
}

// function getForgeDataBuildStatement(type: TypeNode, value: any): StructuredText {
//   if (type instanceof ValueType) {
//     assert(typeof value === "string", "IntegerType value must be a string");
//     if (type instanceof EnumType) {
//       value = `${type.name}.${type.members[+value]}`;
//     }
//     return `${type.writeParameter(DataLocation.Memory)} = ${value};`;
//   }
//   if (type instanceof ArrayType) {
//     assert(Array.isArray(value), "ArrayType value must be an array");
//     const values = value.map((v) => getForgeDataBuildStatement(type.baseType, v));
//     if (type.isDynamicallySized) {
//       return [`${type.writeParameter(DataLocation.Memory)} = [`, addCommaSeparators(values), "];"];
//     }
//     const body = [
//       `${type.writeParameter(DataLocation.Memory)} = new ${type.canonicalName}(${values.length});`,
//       ...values.map((v, i) => `${type.labelFromParent}[${i}] = ${v};`)
//     ];
//     // values.forEach((v, i) => {
//     //   body.push(`${type.writeParameter(DataLocation.Memory, `[${i}]`)} = ${v};`)
//     // });
//     return body;
//   }
//   if (type instanceof StructType) {
//     assert(typeof value === "object", "StructType value must be an object");
//     const values = type.children.map((c) =>
//       getForgeDataBuildStatement(c, value[c.labelFromParent as string])
//     );
//     const body = [
//       `${type.writeParameter(DataLocation.Memory)};`,
//       ...type.vMembers.map((member, i) => `${type.labelFromParent}.${member.labelFromParent} = ${}`)
//     ]
//   }
//   return [];
// }

// const makeTestFor = (ctx: WrappedScope, type: TypeNode) => {
//   const data = getDefaultForType(type, 3);
//   const json = toJson(data);
//   const jsonString = `"${json.replace(/"/g, '\\"')}"`;
//   const serializeFn = `serialize${type.pascalCaseName}`;
//   const name = `testSerialize${type.pascalCaseName}`;
//   const body = [
//     `string memory expected = ${jsonString};`,
//     `string memory actual = ${serializeFn}(value);`,
//     `assertEq(expected, actual);`
//   ];
//   ctx.addFunction;
// };
