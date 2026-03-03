import { CodegenContext } from "../../../../codegen/utils";
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
  addImports,
  coerceArray,
  CompileHelper,
  Logger,
  NoopLogger,
  StructuredText
} from "../../../../utils";
import { getLibJson } from "../../../../codegen/solidity_libraries";
import path from "path";
import { Mapping, StructDefinition } from "solc-typed-ast";
import { structDefinitionToTypeNode } from "../../../../readers";

export type CoderOptions = {
  decoderFileName?: string;
  outPath?: string;
};

/**
 * Generates JSON serializer functions for all struct types in the given Solidity file.
 * Creates functions that use Forge's `Vm` cheatcode for JSON serialization, with
 * support for nested structs, arrays, enums, and all value types.
 *
 * @param helper - Compiler helper with the loaded source
 * @param fileName - Source file containing struct definitions
 * @param options - Output path and filename configuration
 * @param struct - Optional filter: only generate for these struct names
 * @param logger - Logger instance for debug output
 */
export function generateForgeJsonSerializers(
  helper: CompileHelper,
  fileName: string,
  options: CoderOptions = {},
  struct?: string | string[],
  logger: Logger = new NoopLogger()
): void {
  const serializerFileName = options.decoderFileName ?? fileName.replace(".sol", "Serializers.sol");
  const ctx = new CodegenContext(helper, serializerFileName);
  const sourceUnit = helper.getSourceUnit(fileName);
  const vmName = options.outPath ? path.join(options.outPath, `LibJson.sol`) : `LibJson.sol`;
  const libJson = helper.addSourceUnit(vmName, getLibJson());
  addImports(ctx.decoderSourceUnit, libJson, []);
  addImports(ctx.decoderSourceUnit, sourceUnit, []);
  let structDefinitions = sourceUnit
    .getChildrenByType(StructDefinition)
    .filter((struct) => struct.getChildrenByType(Mapping).length === 0);
  if (struct) {
    structDefinitions = structDefinitions.filter((s) => coerceArray(struct).includes(s.name));
  }

  const structs = structDefinitions.map(s => structDefinitionToTypeNode(s));
  for (const struct of structs) {
    getForgeJsonSerializeFunction(ctx, struct);
  }
  ctx.applyPendingFunctions();
}

const builtinSerializers = {
  bool: "serializeBool",
  uint256: "serializeUint",
  int256: "serializeInt",
  address: "serializeAddress",
  bytes32: "serializeBytes32",
  string: "serializeString",
  bytes: "serializeBytes",
  "bool[]": "serializeBool",
  "uint256[]": "serializeUint",
  "int256[]": "serializeInt",
  "address[]": "serializeAddress",
  "bytes32[]": "serializeBytes32",
  "string[]": "serializeString"
} as Record<string, string>;

/**
 * Recursively generates or retrieves a Forge JSON serialize function for the given type.
 * Returns the function name. For builtin types (uint256, address, etc.), delegates
 * directly to the corresponding `vm.serialize*` method. For composite types,
 * generates custom serialization logic.
 */
export function getForgeJsonSerializeFunction(ctx: CodegenContext, type: TypeNode): string {
  const baseSignature = type.signatureInExternalFunction(true);
  const builtinName = builtinSerializers[baseSignature];
  if (builtinName) {
    const body = [`return vm.${builtinName}(objectKey, valueKey, value);`];
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

/**
 * Generates a JSON serializer for an enum type that maps enum values to their
 * string member names using a memory array lookup.
 */
export function getForgeSerializeEnumFunction(ctx: CodegenContext, type: EnumType): string {
  // const baseSerialize = getForgeJsonSerializeFunction(ctx, type);
  const body: StructuredText<string> = [
    `string[${type.members.length}] memory members = [`,
    addCommaSeparators(type.members.map((m) => `"${m}"`)),
    "];",
    `uint256 index = uint256(value);`,
    `return vm.serializeString(objectKey, valueKey, members[index]);`
  ];
  return addSerializeFunction(ctx, type, body);
}

// const randomId

function addSerializeFunction(ctx: CodegenContext, type: TypeNode, body: StructuredText<string>) {
  const baseSignature = type.canonicalName; //signatureInExternalFunction(true);
  const typeWithLocation = type.isReferenceType ? `${baseSignature} memory` : baseSignature;
  const name = `tojson${type.pascalCaseName}`;
  const code = [
    `function ${name}(string memory objectKey, string memory valueKey, ${typeWithLocation} value) returns (string memory) {`,
    body,
    "}"
  ];
  return ctx.addFunction(name, code);
}

/**
 * Generates a JSON serializer for an array type. Iterates elements, serializes
 * each with its base type serializer, and wraps the result in a JSON object
 * keyed by index.
 */
export function getForgeSerializeArrayFunction(ctx: CodegenContext, type: ArrayType): string {
  const baseSerialize = getForgeJsonSerializeFunction(ctx, type.baseType);
  let ref = `value[i]`;
  if (type.baseType instanceof ContractType) {
    ref = `address(${ref})`;
  }
  const body = [
    `string memory obj = string.concat(objectKey, valueKey);`,
    `uint256 length = value.length;`,
    `string memory out;`, //${type.signatureInExternalFunction(true)}
    `for (uint256 i; i < length; i++) {`,
    [`out = ${baseSerialize}(obj, vm.toString(i), ${ref});`],
    `}`,
    `return vm.serializeString(objectKey, valueKey, out);`
  ];
  return addSerializeFunction(ctx, type, body);
}

/**
 * Generates a JSON serializer for a struct type. Serializes each member field
 * using its type-specific serializer, with the last field capturing the final
 * JSON string.
 */
export function getForgeSerializeStructFunction(ctx: CodegenContext, struct: StructType): string {
  const body: StructuredText<string> = [`string memory obj = string.concat(objectKey, valueKey);`];
  struct.children.forEach((child, i) => {
    const fn = getForgeJsonSerializeFunction(ctx, child);
    let ref = `value.${child.labelFromParent}`;
    if (child instanceof ContractType) {
      ref = `address(${ref})`;
    }
    const statement = `${fn}(obj, "${child.labelFromParent}", ${ref});`;

    if (i === struct.children.length - 1) {
      body.push(`string memory finalJson = ${statement}`);
      body.push(`return vm.serializeString(objectKey, valueKey, finalJson);`);
    } else {
      body.push(statement);
    }
  });
  return addSerializeFunction(ctx, struct, body);
}
