import path from "path";
import {
  ContractDefinition,
  ContractKind,
  Mapping,
  staticNodeFactory,
  StructDefinition
} from "solc-typed-ast";
import {
  addImports,
  coerceArray,
  CompileHelper,
  Logger,
  NoopLogger,
  addCommaSeparators,
  StructuredText
} from "../../../../utils";
import { getSTDAssertionsShim } from "../../../../codegen/solidity_libraries";
import { CodegenContext, ContractCodegenContext } from "../../../../codegen/utils";
import { structDefinitionToTypeNode } from "../../../../readers";
import {
  ArrayType,
  ContractType,
  DefaultVisitor,
  EnumType,
  FixedBytesType,
  IntegerType,
  ReferenceType,
  StructType,
  TypeNode,
  ValueType
} from "../../../../ast";

export type CoderOptions = {
  decoderFileName?: string;
  outPath?: string;
};
/**
 * Generates Forge equality assertion functions for all struct types in the given
 * Solidity file. Creates an `Assertions` contract that extends `StdAssertions`
 * with type-specific `assertEq` overloads for each struct and its nested types.
 *
 * @param helper - Compiler helper with the loaded source
 * @param fileName - Source file containing struct definitions
 * @param options - Output path configuration
 * @param struct - Optional filter: only generate for these struct names
 * @param logger - Logger instance for debug output
 */
export function generateAssertions(
  helper: CompileHelper,
  fileName: string,
  options: CoderOptions = {},
  struct?: string | string[],
  logger: Logger = new NoopLogger()
): void {
  const serializerFileName = options.decoderFileName ?? fileName.replace(".sol", "Assertions.sol");
  const ctx = new CodegenContext(helper, serializerFileName);

  const sourceUnit = helper.getSourceUnit(fileName);
  const vmName = options.outPath ? path.join(options.outPath, `Tmp_Assert.sol`) : `Tmp_Assert.sol`;
  const vm = helper.addSourceUnit(vmName, getSTDAssertionsShim());
  addImports(ctx.decoderSourceUnit, vm, []);
  addImports(ctx.decoderSourceUnit, sourceUnit, []);
  const lib = ctx.addContract("Assertions", ContractKind.Contract, [
    vm.getChildrenByType(ContractDefinition).find((c) => c.name === "StdAssertions")?.id as number
  ]);
  ctx.addCustomTypeUsingForDirective(
    "uint256",
    staticNodeFactory.makeIdentifierPath(
      sourceUnit.requiredContext,
      "LibString",
      vm.getChildrenByType(ContractDefinition).find((c) => c.name === "LibString")?.id as number
    ),
    undefined,
    false
  );
  let structDefinitions = sourceUnit
    .getChildrenByType(StructDefinition)
    .filter((struct) => struct.getChildrenByType(Mapping).length === 0);
  if (struct) {
    structDefinitions = structDefinitions.filter((s) => coerceArray(struct).includes(s.name));
  }

  const structs = structDefinitions.map(s => structDefinitionToTypeNode(s));
  for (const struct of structs) {
    getForgeAssertEqualityFunction(lib, struct);
  }
  lib.applyPendingFunctions();
  ctx.applyPendingContracts();
}

// Maps canonical type signatures to their builtin forge-std assertion function names.
// Types matching these signatures skip custom assertion generation entirely.
const builtinSerializers = {
  bool: "assertEq",
  uint256: "assertEq",
  int256: "assertEq",
  address: "assertEq",
  bytes32: "assertEq",
  string: "assertEq",
  bytes: "assertEq",
  "uint256[]": "assertEq",
  "int256[]": "assertEq",
  "address[]": "assertEq"
} as Record<string, string>;

/**
 * Visitor that generates `assertEq` overloads for each type node. Uses the
 * visitor pattern to recursively handle structs, arrays, enums, and value types.
 *
 * For types that match a builtin assertion (e.g. `uint256`, `address`, `bytes`),
 * the visitor short-circuits and returns the builtin `assertEq` name directly.
 * For composite types, it generates custom assertion functions that recursively
 * compare each field/element with a descriptive key path.
 */
export class AssertEqVisitor extends DefaultVisitor {
  defaultReturnValue = "assertEq";

  addAssertEqFunction(type: TypeNode, body: StructuredText<string>): string {
    const name = `assertEq${type.pascalCaseName}`;
    if (this.ctx.hasFunction(name)) return name;
    const baseSignature = type.canonicalName; //signatureInExternalFunction(true);
    const typeWithLocation = type.isReferenceType ? `${baseSignature} memory` : baseSignature;

    const code = [
      `function ${name}(${typeWithLocation} actual, ${typeWithLocation} expected, string memory key) internal {`,
      body,
      "}"
    ];
    return this.ctx.addFunction(name, code);
  }

  constructor(public ctx: ContractCodegenContext) {
    super();
  }

  visit<T extends TypeNode>(type: T): string {
    const baseSignature = type.signatureInExternalFunction(true);
    const builtinName = builtinSerializers[baseSignature];
    if (builtinName) {
      return "assertEq";
    }
    return super.visit(type as any);
  }

  visitArray(type: ArrayType): string {
    const fn = this.visit(type.baseType);

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
    return this.addAssertEqFunction(type, body);
  }

  visitStruct(struct: StructType): string {
    const body: StructuredText<string> = [];
    struct.children.forEach((child) => {
      const fn = this.visit(child);
      const actual = wrapAddress(child, `actual.${child.labelFromParent}`);
      const expected = wrapAddress(child, `expected.${child.labelFromParent}`);
      const statement = `${fn}(${actual}, ${expected}, string.concat(key, ".${child.labelFromParent}"));`;
      body.push(statement);
    });
    return this.addAssertEqFunction(struct, body);
  }

  visitEnum(type: EnumType): string {
    const body: StructuredText<string> = [
      `string[${type.members.length}] memory members = [`,
      addCommaSeparators(type.members.map((m) => `"${m}"`)),
      "];",
      `assertEq(members[uint256(actual)], members[uint256(expected)], key);`
    ];
    return this.addAssertEqFunction(type, body);
  }

  visitUnmatchedValueType(type: ValueType): string {
    const baseSignature = type.signatureInExternalFunction(true);
    if (baseSignature.startsWith("int") || baseSignature.startsWith("uint")) {
      return this.visit(new IntegerType(256, baseSignature.startsWith("i")));
    }
    if (baseSignature.startsWith("bytes")) {
      return this.visit(new FixedBytesType(32));
    }
    throw Error(`Could not make serializer for type: ${type.pp()}`);
  }

  visitUnmatchedReferenceType(type: ReferenceType): string {
    throw Error(`Could not make serializer for type: ${type.pp()}`);
  }
}

const wrapAddress = (type: TypeNode, expr: string) => {
  if (type instanceof ContractType) {
    return `address(${expr})`;
  }
  return expr;
};

/**
 * Entry point for generating an assertEq function for a given type node.
 * Creates a new {@link AssertEqVisitor} and visits the type to produce
 * the assertion function, registering it on the codegen context.
 */
export function getForgeAssertEqualityFunction(
  ctx: ContractCodegenContext,
  type: TypeNode
): string {
  return new AssertEqVisitor(ctx).visit(type);
}
