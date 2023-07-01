import { DataLocation } from "solc-typed-ast";
import {
  ArrayType,
  ContractType,
  EnumType,
  FixedBytesType,
  IntegerType,
  StructType,
  TypeNode,
  ValueType
} from "../../ast";
import { addCommaSeparators, StructuredText } from "../../utils";
import { CodegenContext } from "../utils";

const builtinSerializers = {
  bool: "serializeBool",
  uint256: "serializeUint",
  int256: "serializeInt",
  address: "serializeAddress",
  bytes32: "serializeBytes32",
  string: "serializeString",
  bytes: "serializeBytes",
  "bool[]": "serializeBoolArray",
  "uint256[]": "serializeUintArray",
  "int256[]": "serializeIntArray",
  "address[]": "serializeAddressArray",
  "bytes32[]": "serializeBytes32Array",
  "string[]": "serializeStringArray"
} as Record<string, string>;

const obj = {
  "bool[]": "serializeBoolArray",
  // "uint256[]": "serializeUintArray",
  "int256[]": "serializeIntArray",
  "address[]": "serializeAddressArray",
  "bytes32[]": "serializeBytes32Array",
  "string[]": "serializeStringArray"
};

export function getForgeJsonSerializeFunction(ctx: CodegenContext, type: TypeNode): string {
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

export function getForgeSerializeEnumFunction(ctx: CodegenContext, type: EnumType): string {
  const body: StructuredText<string> = [
    `string[${type.members.length}] memory members = [`,
    addCommaSeparators(type.members.map((m) => `"${m}"`)),
    "];",
    `uint256 index = uint256(value);`,
    `return members[index];`
  ];
  return addSerializeFunction(ctx, type, body);
}

// const randomId

function addSerializeFunction(ctx: CodegenContext, type: TypeNode, body: StructuredText<string>) {
  const name = `serialize${type.pascalCaseName}`;
  const code = [
    `function ${name}(${type.writeParameter(
      DataLocation.Memory,
      "value"
    )}) pure returns (string memory) {`,
    body,
    "}"
  ];
  return ctx.addFunction(name, code);
}

export function getForgeSerializeArrayFunction(ctx: CodegenContext, type: ArrayType): string {
  const baseSerialize = getForgeJsonSerializeFunction(ctx, type.baseType);
  const baseArg = type.baseType.writeParameter(DataLocation.Memory, "");
  const body: StructuredText[] = [
    `function(uint256[] memory, function(uint256) pure returns (string memory)) internal pure returns (string memory) _fn = serializeArray;`,
    `function(${type.writeParameter(
      DataLocation.Memory,
      ""
    )}, function(${baseArg}) pure returns (string memory)) internal pure returns (string memory) fn;`,
    `assembly { fn := _fn }`,
    `return fn(value, ${baseSerialize});`
  ];
  return addSerializeFunction(ctx, type, body);
}

/*       '{"account":', data.account.serializeAddress(),
      ',"userBalance":', data.userBalance.serializeUint(),
      ',"someArray":', data.someArray.serializeArray(LibJson.serializeUint),
      '}' */

export function getForgeSerializeStructFunction(ctx: CodegenContext, struct: StructType): string {
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
    // const segment = ["'", i === 0 ? "{" : ",", `"${child.labelFromParent}":'`, `${fn}(${ref})`];
    // segments.push(...segment);
  });
  segments.push("'}'");
  // addCommaSeparators(segments);
  return addSerializeFunction(ctx, struct, [`return string.concat(`, segments.join(","), `);`]);
}
