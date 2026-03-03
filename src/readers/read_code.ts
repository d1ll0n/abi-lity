/**
 * Raw Solidity source reader — parses source text into abi-lity TypeNodes
 * without invoking the Solidity compiler.
 *
 * Uses `@solidity-parser/parser` to build a lightweight AST, then converts
 * type-defining nodes (structs, enums, functions, errors, events, state variables,
 * user-defined value types) into abi-lity TypeNodes.
 *
 * Two-pass approach:
 * 1. **Collect** — Visit the parsed AST to gather all relevant definition nodes
 * 2. **Sort & Convert** — Topologically sort by type dependencies (so structs are
 *    resolved before functions that reference them), then convert each node
 *
 * Special features:
 * - Public state variables are synthesized into getter `FunctionType` nodes
 *   (including mapping key unwinding)
 * - Functions are deduplicated by selector; internal-visibility duplicates are
 *   stored under their internal signature instead
 * - `type X is Y` definitions (user-defined value types) are supported
 *
 * Limitations:
 * - Cannot evaluate complex constant expressions for array sizes (only number literals)
 * - `allowUndefinedUserTypes` flag creates placeholder `EnumType` for unresolved references
 * - No access to inherited types from base contracts
 *
 * @see docs/readers.md for when to use this reader vs the others.
 */
import * as parser from "@solidity-parser/parser";
import {
  StructDefinition,
  EnumDefinition,
  FunctionDefinition,
  CustomErrorDefinition,
  EventDefinition,
  StateVariableDeclaration,
  TypeName,
  TypeDefinition,
  ASTVisitor,
  NumberLiteral,
  VariableDeclaration,
  // AssemblyAssignment,
  // AssemblyBlock,
  AssemblyCall,
  // AssemblyFor,
  // AssemblyIf,
  // AssemblyCase,
  // AssemblySwitch,
  AssemblyLiteral,
  AssemblyLocalDefinition,
  AssemblyMemberAccess,
  AssemblyAssignment,
  Identifier,
  // AssemblyMemberAccess,
  ASTNode
  // AssemblyStackAssignment,
  // AssemblyLocalDefinition
} from "@solidity-parser/parser/src/ast-types";
import {
  FunctionStateMutability,
  FunctionVisibility,
  staticNodeFactory,
  ASTContext,
  YulLiteralKind,
  YulIdentifier,
  YulTypedName,
  DataLocation
} from "solc-typed-ast";
import {
  ArrayType,
  EnumType,
  ErrorType,
  EventType,
  FunctionType,
  StructType,
  TupleType,
  TypeNode
} from "../ast";
import { ASTContext as ABIContext } from "../ast/ast_context";
import { elementaryTypeStringToTypeNode } from "./elementary";
import { TypeNodeReaderResult } from "./types";

// function AssemblyMemberAccess(ctx: ASTContext, assignment: AssemblyMemberAccess) {
//   const { expression, memberName } = assignment;
//   return staticNodeFactory.makeYulIdentifier(
//     ctx,
//     `${expression.name}.${memberName.name}`,
//     -1,
//     assignment
//   );
// }

// const literalMap: Record<(AssemblyLiteral | NumberLiteral)["type"], YulLiteralKind> = {
//   BooleanLiteral: YulLiteralKind.Bool,
//   DecimalNumber: YulLiteralKind.Number,
//   HexLiteral: YulLiteralKind.String,
//   HexNumber: YulLiteralKind.String,
//   StringLiteral: YulLiteralKind.String,
//   NumberLiteral: YulLiteralKind.Number
// };

// function getVisitor(ctx: ASTContext) {
//   const parseLiteral = (ast: AssemblyLiteral | NumberLiteral): any => {
//     return staticNodeFactory.makeYulLiteral(
//       ctx,
//       literalMap[ast.type],
//       ast.type === "NumberLiteral" ? ast.number : ast.value,
//       ""
//     );
//   };
//   let visitor: ASTVisitor = {};
//   const visitNode = (ast: ASTNode, parent?: ASTNode) => visitor[ast.type]!(ast as any, parent);
//   visitor = {
//     HexLiteral: parseLiteral,
//     NumberLiteral: parseLiteral,
//     StringLiteral: parseLiteral,
//     BooleanLiteral: parseLiteral,
//     AssemblyCall: (ast: AssemblyCall, parent?: ASTNode) => {
//       return staticNodeFactory.makeYulFunctionCall(
//         ctx,
//         staticNodeFactory.makeYulIdentifier(ctx, ast.functionName, -1, ast),
//         ast.arguments.map((node) => visitNode(node, ast)),
//         ast
//       );
//     },
//     Identifier: (ast: Identifier, parent?: ASTNode) => {
//       if (parent?.type.includes("Assembly")) {
//         return staticNodeFactory.makeYulIdentifier(ctx, ast.name, -1, ast);
//       }
//       return staticNodeFactory.makeIdentifier(ctx, "", ast.name, -1, ast);
//     },
//     AssemblyAssignment: (ast: AssemblyAssignment) => {
//       return staticNodeFactory.makeYulAssignment(
//         ctx,
//         ast.names.map((name) => visitNode(name, ast)) as YulIdentifier[],
//         visitNode(ast.expression, ast),
//         undefined,
//         ast
//       );
//     },
//     AssemblyMemberAccess: (ast: AssemblyMemberAccess) => {
//       return staticNodeFactory.makeYulIdentifier(
//         ctx,
//         `${ast.expression.name}.${ast.memberName.name}`,
//         -1,
//         ast
//       );
//     },
//     AssemblyLocalDefinition: (ast: AssemblyLocalDefinition) => {
//       return staticNodeFactory.makeYulVariableDeclaration(
//         ctx,
//         ast.names.map((name) => {
//           const node = visitNode(name, ast) as YulIdentifier;
//           return staticNodeFactory.makeYulTypedName(ctx, node.name, undefined, node);
//         }),
//         ast.expression && visitNode(ast.expression, ast),
//         undefined,
//         ast
//       );
//     }

//     /*    AssemblyStackAssignment: (ast: AssemblyStackAssignment) => {
//       return staticNodeFactory.makeYulAssignment()
//     } */
//     // AssemblyCase: (ast: AssemblyCase) => {}
//   };
// }

/**
 * Mapped type that requires an `add${DefinitionType}` method for each definition kind.
 * Used as an interface constraint on `ParserTypes` to ensure all definition types are handled.
 */
type AddMethods = {
  [K in RelevantDefinition["type"] as `add${K}`]: (
    node: Extract<RelevantDefinition, { type: K }>
  ) => void;
};

/**
 * Converts parser AST definitions into abi-lity TypeNodes.
 *
 * Implements the `AddMethods` interface, providing an `add${Type}` method for each
 * definition kind. Types are stored in `mappedTypes` keyed by name (structs, enums,
 * type definitions) or selector (functions, errors, events), enabling forward references
 * during recursive type resolution.
 *
 * The `getTypeNode()` method resolves `TypeName` AST nodes by dispatching on node type:
 * - `ElementaryTypeName` → `elementaryTypeStringToTypeNode()`
 * - `ArrayTypeName` → `ArrayType` (recurses into base type)
 * - `UserDefinedTypeName` → lookup from `mappedTypes` (or placeholder if `allowUndefinedUserTypes`)
 * - `FunctionTypeName` → `FunctionType` with converted params/returns
 */
class ParserTypes implements AddMethods {
  /** Categorizes all collected types into a `TypeNodeReaderResult`, registering each in a fresh context. */
  get typeNodesByKind() {
    const context = new ABIContext();
    const typeNodes = [...this.mappedTypes.values()];
    const functions: FunctionType[] = [];
    const structs: StructType[] = [];
    const events: EventType[] = [];
    const errors: ErrorType[] = [];
    const enums: EnumType[] = [];
    typeNodes.forEach((node) => {
      node.context = context;
      if (node instanceof FunctionType) functions.push(node);
      else if (node instanceof StructType) structs.push(node);
      else if (node instanceof EventType) events.push(node);
      else if (node instanceof ErrorType) errors.push(node);
      else if (node instanceof EnumType) enums.push(node);
    });
    return { context, functions, structs, events, errors, enums };
  }

  parsedNodes: RelevantDefinition[] = [];
  mappedTypes: Map<string, TypeNode> = new Map();
  constructor(public allowUndefinedUserTypes = false) {}

  /**
   * Resolves a parser `TypeName` AST node to an abi-lity TypeNode.
   *
   * For `UserDefinedTypeName`, looks up the type in `mappedTypes`. If not found and
   * `allowUndefinedUserTypes` is set, creates a placeholder `EnumType` with no members.
   * Array sizes are limited to number literals — complex constant expressions are not evaluated.
   */
  getTypeNode(node: TypeName): TypeNode {
    if (node.type === "ElementaryTypeName") return elementaryTypeStringToTypeNode(node.name);
    if (node.type === "ArrayTypeName") {
      const baseType = this.getTypeNode(node.baseTypeName);
      const length = node.length ? +(node.length as NumberLiteral).number : undefined;
      return new ArrayType(baseType, length === undefined ? undefined : length);
    }
    if (node.type === "UserDefinedTypeName") {
      const type = this.mappedTypes.get(node.namePath);

      if (!type) {
        if (this.allowUndefinedUserTypes) {
          return new EnumType(node.namePath, []);
        }
        throw Error(`UserDefinedTypeName ${node.namePath} not found!`);
      }
      return type.copy();
    }
    if (node.type === "FunctionTypeName") {
      const parameters = this.convertVariableDeclarations(node.parameterTypes);
      const returnParameters = this.convertVariableDeclarations(node.returnTypes);

      return new FunctionType(
        "",
        parameters.length > 0 ? new TupleType(parameters) : undefined,
        returnParameters.length > 0 ? new TupleType(returnParameters) : undefined,
        this.convertVisibility(node.visibility),
        this.convertMutability(node.stateMutability ?? "")
      );
    }
    throw Error(`Unimplemented TypeName ${node.type}`);
  }

  /**
   * Unwinds nested `Mapping` types into flat key/value arrays for getter synthesis.
   *
   * For `mapping(address => mapping(uint256 => bool))`, returns
   * `{ keys: [AddressType, IntegerType(256)], value: BoolType }`.
   */
  getStateVariableKeyTypes(node: TypeName): { keys: TypeNode[]; value: TypeNode } {
    const keys: TypeNode[] = [];
    let value: TypeNode | undefined;

    if (node.type === "Mapping") {
      keys.push(this.getTypeNode(node.keyType));
      const result = this.getStateVariableKeyTypes(node.valueType);
      keys.push(...result.keys);
      value = result.value;
    } else {
      value = this.getTypeNode(node);
    }
    return { keys, value };
  }

  /** Converts parser `VariableDeclaration[]` to TypeNodes, preserving parameter names as `labelFromParent`. */
  convertVariableDeclarations(variables: VariableDeclaration[]): TypeNode[] {
    const members = variables.map((member) => {
      if (member.typeName) {
        const parameter = this.getTypeNode(member.typeName);
        parameter.labelFromParent = member.name || undefined;
        return parameter;
      }
      return undefined;
    });
    if (!members.every(Boolean)) {
      throw Error(`Some variables have no defined type`);
    }
    return members as TypeNode[];
  }

  addStructDefinition(node: StructDefinition) {
    const members = this.convertVariableDeclarations(node.members);
    if (!members.every(Boolean)) throw Error(`Some struct members have no defined type`);
    const struct = new StructType(members as TypeNode[], node.name);
    this.mappedTypes.set(node.name, struct);
  }

  addEnumDefinition(node: EnumDefinition) {
    const type = new EnumType(
      node.name,
      node.members.map((member) => member.name)
    );
    this.mappedTypes.set(node.name, type);
  }

  addTypeDefinition(node: TypeDefinition) {
    const type = elementaryTypeStringToTypeNode(node.definition.name);
    this.mappedTypes.set(node.name, type);
  }

  /**
   * Converts a function definition, deduplicating by selector.
   *
   * If a function with the same selector already exists and the new one has
   * internal/private visibility, it is stored under its internal signature instead.
   * This preserves both the external-facing function and any internal overload.
   */
  addFunctionDefinition(ast: FunctionDefinition) {
    const args = this.convertVariableDeclarations(ast.parameters);
    const rets = this.convertVariableDeclarations(ast.returnParameters || []);
    if (!(args.every(Boolean) && rets.every(Boolean) && ast.name)) {
      throw Error("Some parameters have undefined types");
    }
    const parameters = new TupleType(args as TypeNode[]);
    const returnParameters = new TupleType(rets as TypeNode[]);
    const type = new FunctionType(
      ast.name,
      parameters,
      returnParameters,
      ast.visibility as FunctionVisibility,
      ast.stateMutability as FunctionStateMutability
    );
    if (
      this.mappedTypes.has(type.functionSelector) &&
      ![FunctionVisibility.External, FunctionVisibility.Public].includes(type.visibility as any)
    ) {
      // console.log(
      // `Duplicate external selector for ${type.name} but visibility is ${type.visibility} - adding with internal signature`
      // );
      this.mappedTypes.set(type.internalSignature(), type);
    } else {
      this.mappedTypes.set(type.functionSelector, type);
    }
  }

  addEventDefinition(ast: EventDefinition) {
    const parameters = this.convertVariableDeclarations(ast.parameters);
    const type = new EventType(ast.name, parameters.length ? new TupleType(parameters) : undefined);
    this.mappedTypes.set(type.eventSelector, type);
  }

  addCustomErrorDefinition(ast: CustomErrorDefinition) {
    const parameters = this.convertVariableDeclarations(ast.parameters);
    const type = new ErrorType(ast.name, parameters.length ? new TupleType(parameters) : undefined);
    this.mappedTypes.set(type.errorSelector, type);
  }

  convertVisibility(visibility: string): FunctionVisibility {
    switch (visibility) {
      case "external":
        return FunctionVisibility.External;
      case "internal":
        return FunctionVisibility.Internal;
      case "public":
        return FunctionVisibility.Public;
      case "private":
        return FunctionVisibility.Private;
      default:
        return FunctionVisibility.Default;
    }
  }

  convertMutability(mutability: string): FunctionStateMutability {
    switch (mutability) {
      case "pure":
        return FunctionStateMutability.Pure;
      case "view":
        return FunctionStateMutability.View;
      case "payable":
        return FunctionStateMutability.Payable;
      case "constant":
        return FunctionStateMutability.Constant;
      default:
        return FunctionStateMutability.NonPayable;
    }
  }

  /**
   * Synthesizes getter `FunctionType` nodes for public state variables.
   *
   * For mappings, unwinds nested key types into function parameters.
   * For example, `mapping(address => uint256) public balances` becomes
   * `function balances(address) external view returns (uint256)`.
   */
  addStateVariableDeclaration(ast: StateVariableDeclaration) {
    ast.variables.forEach((variable) => {
      if (variable.visibility !== "public" || !variable.typeName || !variable.name) return;

      const { keys, value } = this.getStateVariableKeyTypes(variable.typeName);
      const type = new FunctionType(
        variable.name,
        new TupleType(keys),
        new TupleType([value]),
        FunctionVisibility.External,
        FunctionStateMutability.View
      );
      this.mappedTypes.set(variable.name, type);
    });
  }

  /** Dynamic dispatch: calls `this.add${node.type}(node)` for the given definition. */
  addType(node: RelevantDefinition) {
    const fnKey = `add${node.type}`;
    (this as any)[fnKey](node);
  }
}

/* function doTest(code: string) {
  const visitor = (
    [
      "StructDefinition",
      "EnumDefinition",
      "FunctionDefinition",
      "CustomErrorDefinition",
      "EventDefinition",
      "StateVariableDeclaration",
      "TypeDefinition",
      "VariableDeclaration"
    ] as Array<RelevantDefinition["type"] | "VariableDeclaration">
  ).reduce((obj, key) => {
    obj[key] = (node: RelevantDefinition | VariableDeclaration) => {
      switch (node.type) {
        case "VariableDeclaration": {
          node.
        }
      }
      console.log(node);
    };
    return obj;
  }, {} as ASTVisitor);
  const parseResult = parser.parse(code, { tolerant: true });
  parser.visit(parseResult, visitor);
} */

/**
 * Main entry point: parses raw Solidity source text into abi-lity TypeNodes.
 *
 * Uses a two-pass approach:
 * 1. Parse the source and visit the AST to collect all type-defining nodes
 * 2. Topologically sort definitions by dependency, then convert each via `ParserTypes`
 *
 * @param code - Raw Solidity source text (interface, contract, or free-standing definitions)
 * @param allowUndefinedUserTypes - If `true`, creates placeholder `EnumType` for unresolved
 *   user-defined types instead of throwing. Useful for parsing incomplete source fragments.
 * @returns Unified `TypeNodeReaderResult` with all discovered types
 */
export function readTypeNodesFromSolidity(
  code: string,
  allowUndefinedUserTypes = false
): TypeNodeReaderResult {
  const types = new ParserTypes(allowUndefinedUserTypes);
  const visitor = (
    [
      "StructDefinition",
      "EnumDefinition",
      "FunctionDefinition",
      "CustomErrorDefinition",
      "EventDefinition",
      "StateVariableDeclaration",
      "TypeDefinition"
    ] as Array<RelevantDefinition["type"]>
  ).reduce((obj, key) => {
    obj[key] = (node: RelevantDefinition) => {
      types.parsedNodes.push(node);
    };
    return obj;
  }, {} as ASTVisitor);
  const ts = Date.now();
  const parseResult = parser.parse(code, { tolerant: true });
  console.log(`Parsing took ${(Date.now() - ts) / 1000}seconds`);
  parser.visit(parseResult, visitor);
  sortTypesByDependencies(types.parsedNodes);
  types.parsedNodes.forEach((node) => {
    types.addType(node);
  });
  return types.typeNodesByKind;
}

/** Union of all parser AST node types that define types relevant to ABI encoding. */
type RelevantDefinition =
  | StructDefinition
  | EnumDefinition
  | FunctionDefinition
  | CustomErrorDefinition
  | EventDefinition
  | StateVariableDeclaration
  | TypeDefinition;

/** Subset of definitions that can be referenced by other types (structs, enums, type aliases). */
type PotentialDependency = StructDefinition | EnumDefinition | TypeDefinition;

/** Recursively unwraps array types to find a `UserDefinedTypeName` reference, if any. */
const extractUserDefinedTypeName = (typeName: TypeName): string | undefined => {
  if (typeName.type === "ArrayTypeName") {
    return extractUserDefinedTypeName(typeName.baseTypeName);
  }
  if (typeName.type === "UserDefinedTypeName") {
    return typeName.namePath;
  }
  return undefined;
};

/** Extracts all user-defined type names referenced by a list of typed fields. */
const extractUserDefinedTypes = (fields: Array<{ typeName: TypeName | null }>): string[] => {
  const types: string[] = [];
  fields.forEach((field) => {
    if (!field.typeName) return;
    const typeName = extractUserDefinedTypeName(field.typeName);
    if (typeName) types.push(typeName);
  });
  return types;
};

/** Returns the names of all user-defined types that a definition directly references. */
function extractTypeDependencies(type: RelevantDefinition): string[] {
  switch (type.type) {
    case "EnumDefinition":
      return [];
    case "TypeDefinition":
      return [];
    case "CustomErrorDefinition":
    case "EventDefinition":
      return extractUserDefinedTypes(type.parameters);
    case "StructDefinition":
      return extractUserDefinedTypes(type.members);
    case "FunctionDefinition":
      return [
        ...extractUserDefinedTypes(type.parameters),
        ...extractUserDefinedTypes(type.returnParameters || [])
      ];
    case "StateVariableDeclaration":
      return extractUserDefinedTypes(type.variables);
  }
}

/**
 * Topologically sorts definitions so types are resolved before their dependents.
 *
 * Two-pass algorithm:
 * 1. **Direct dependencies** — For each definition, extract the user-defined type names
 *    it references and map them to the corresponding `PotentialDependency` nodes.
 * 2. **Transitive expansion** — Recursively walk each node's dependency set, adding
 *    all transitive dependencies. Detects circular dependencies (throws on self-reference).
 *
 * The final sort places dependency-free types first, then orders by dependency relationship:
 * if A depends on B, A comes after B.
 *
 * Mutates the `types` array in place.
 */
function sortTypesByDependencies(types: RelevantDefinition[]): void {
  // Pass 1: Collect direct dependencies for each definition
  const dependenciesMap = new Map<RelevantDefinition, Set<RelevantDefinition>>();
  const typeDefinitions = types.filter((t) =>
    ["EnumDefinition", "StructDefinition", "TypeDefinition"].includes(t.type)
  ) as PotentialDependency[];
  const findDependency = (name: string): PotentialDependency => {
    const dependency = typeDefinitions.find((t) => t.name === name);
    if (!dependency) {
      throw Error(`Could not find type dependency ${name}`);
    }
    return dependency;
  };

  for (const type of types) {
    dependenciesMap.set(type, new Set(extractTypeDependencies(type).map(findDependency)));
  }

  // Pass 2: Transitively expand — if A depends on B and B depends on C, A depends on {B, C}
  const updateNestedDependencies = (type: RelevantDefinition) => {
    const dependencies = dependenciesMap.get(type) as Set<PotentialDependency>;
    for (const dep of dependencies.values()) {
      if (dep === type) throw Error(`Circular dependency in ${type.name}`);
      updateNestedDependencies(dep);
      const subDependencies = dependenciesMap.get(dep) as Set<PotentialDependency>;
      for (const subDependency of subDependencies.values()) {
        dependencies.add(subDependency);
      }
    }
  };
  types.forEach(updateNestedDependencies);

  // Sort: dependency-free types first, then by dependency ordering
  types.sort((a, b) => {
    const aDependencies = dependenciesMap.get(a) as Set<RelevantDefinition>;
    const bDependencies = dependenciesMap.get(b) as Set<RelevantDefinition>;
    if (
      (aDependencies.size && !bDependencies.size) || //  a has dependencies and b does not = a goes after b
      aDependencies.has(b) // a depends on b = a goes after b
    )
      return 1;

    if (
      (bDependencies.size && !aDependencies.size) || // b has dependencies and a does not = a goes before b
      bDependencies.has(a) // b depends on a = a goes before b
    )
      return -1;

    return 0;
  });
}

// const time = Date.now();
// console.log(
//   readTypeNodesFromSolidity(
//     `function exec(
//       function (ABC memory, uint256[] calldata) internal returns (uint256) fnarg
//     ) internal view returns (uint256) {}
//     function exec(
//       function (ABC memory) internal returns (uint256) fnarg
//     ) internal view returns (uint256) {}

// `,
//     true
//   ).functions[0].internalSignature()
// );

// const since = Date.now() - time;
// // Print seconds since
// console.log(`Seconds since: ${since / 1000}`);
