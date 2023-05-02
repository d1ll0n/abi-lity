import {
  ArrayType,
  ContractType,
  EnumType,
  FixedBytesType,
  IntegerType,
  ReferenceType,
  StructType,
  TypeNode,
  UABIType,
  ValueType
} from "../../ast";
import { addCommaSeparators, StructuredText } from "../../utils";
import { ContractCodegenContext } from "../utils";

const builtinSerializers = {
  bool: "assertEq",
  uint256: "assertEq",
  int256: "assertEq",
  address: "assertEq",
  bytes32: "assertEq",
  string: "assertEq",
  bytes: "assertEq",
  // "bool[]": "assertEq",
  "uint256[]": "assertEq",
  "int256[]": "assertEq",
  "address[]": "assertEq"

  // "bytes32[]": "assertEq",
  // "string[]": "assertEq"
} as Record<string, string>;

const wrapAddress = (type: TypeNode, expr: string) => {
  if (type instanceof ContractType) {
    return `address(${expr})`;
  }
  return expr;
};

export function getForgeAssertEqualityFunction(
  ctx: ContractCodegenContext,
  type: TypeNode
): string {
  const baseSignature = type.signatureInExternalFunction(true);
  const builtinName = builtinSerializers[baseSignature];
  if (builtinName) {
    const body = [`return ${builtinName}(actual, expected, key);`];
    return addAssertEqFunction(ctx, type, body);
  }
  if (type instanceof ArrayType) {
    return getForgeAssertArrayEquality(ctx, type);
  }
  if (type instanceof StructType) {
    return getForgeAssertStructEquality(ctx, type);
  }
  if (type instanceof EnumType) {
    return getForgeAssertEnumEqualityFunction(ctx, type);
  }
  if (type instanceof ValueType) {
    if (baseSignature.startsWith("int") || baseSignature.startsWith("uint")) {
      return getForgeAssertEqualityFunction(
        ctx,
        new IntegerType(256, baseSignature.startsWith("i"))
      );
    }
    if (baseSignature.startsWith("bytes")) {
      return getForgeAssertEqualityFunction(ctx, new FixedBytesType(32));
    }
  }
  throw Error(`Could not make serializer for type: ${type.pp()}`);
}

export function getForgeAssertEnumEqualityFunction(
  ctx: ContractCodegenContext,
  type: EnumType
): string {
  const body: StructuredText<string> = [
    `string[${type.members.length}] memory members = [`,
    addCommaSeparators(type.members.map((m) => `"${m}"`)),
    "];",
    `assertEq(members[uint256(actual)], members[uint256(expected)], key);`
  ];
  return addAssertEqFunction(ctx, type, body);
}

function addAssertEqFunction(
  ctx: ContractCodegenContext,
  type: TypeNode,
  body: StructuredText<string>
) {
  const baseSignature = type.canonicalName; //signatureInExternalFunction(true);
  const typeWithLocation = type.isReferenceType ? `${baseSignature} memory` : baseSignature;
  const name = `assertEq${type.pascalCaseName}`;
  const code = [
    `function ${name}(${typeWithLocation} actual, ${typeWithLocation} expected, string memory key) internal {`,
    body,
    "}"
  ];
  return ctx.addFunction(name, code);
}

export function getForgeAssertArrayEquality(ctx: ContractCodegenContext, type: ArrayType): string {
  const fn = getForgeAssertEqualityFunction(ctx, type.baseType);

  const body = [
    `uint256 length = actual.length;`,
    `assertEq(length, expected.length, string.concat(key, ".length"));`,
    `for (uint256 i; i < length; i++) {`,
    [
      `${fn}(${wrapAddress(type.baseType, "actual[i]")}, ${wrapAddress(
        type.baseType,
        "expected[i]"
      )}, string.concat(key, "[", i.toString(), "]"));`
    ],
    `}`
  ];
  return addAssertEqFunction(ctx, type, body);
}

export function getForgeAssertStructEquality(
  ctx: ContractCodegenContext,
  struct: StructType
): string {
  const body: StructuredText<string> = [];
  struct.children.forEach((child, i) => {
    const fn = getForgeAssertEqualityFunction(ctx, child);
    const actual = wrapAddress(child, `actual.${child.labelFromParent}`);
    const expected = wrapAddress(child, `expected.${child.labelFromParent}`);
    const statement = `${fn}(${actual}, ${expected}, string.concat(key, ".${child.labelFromParent}"));`;
    body.push(statement);
  });
  return addAssertEqFunction(ctx, struct, body);
}
