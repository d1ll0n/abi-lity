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
  VariableDeclaration
  // AssemblyAssignment,
  // AssemblyBlock,
  // AssemblyCall,
  // AssemblyFor,
  // AssemblyIf,
  // AssemblyCase,
  // AssemblySwitch,
  // AssemblyLiteral,
  // Identifier,
  // AssemblyMemberAccess,
  // ASTNode,
  // AssemblyStackAssignment,
  // AssemblyLocalDefinition
} from "@solidity-parser/parser/src/ast-types";
import {
  FunctionStateMutability,
  FunctionVisibility,
  staticNodeFactory
  // ASTContext,
  // YulLiteralKind,
  // YulIdentifier,
  // YulTypedName
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

type AddMethods = {
  [K in RelevantDefinition["type"] as `add${K}`]: (
    node: Extract<RelevantDefinition, { type: K }>
  ) => void;
};

class ParserTypes implements AddMethods {
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

  getTypeNode(node: TypeName): TypeNode {
    if (node.type === "ElementaryTypeName") return elementaryTypeStringToTypeNode(node.name);
    if (node.type === "ArrayTypeName") {
      const baseType = this.getTypeNode(node.baseTypeName);
      const length = node.length ? +(node.length as NumberLiteral).number : undefined;
      return new ArrayType(baseType, length === undefined ? undefined : length);
    }
    if (node.type === "UserDefinedTypeName") {
      const type = this.mappedTypes.get(node.namePath);
      if (!type) throw Error(`UserDefinedTypeName ${node.namePath} not found!`);
      return type.copy();
    }
    throw Error(`Unimplemented TypeName ${node.type}`);
  }

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
    this.mappedTypes.set(type.functionSelector, type);
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

  addType(node: RelevantDefinition) {
    const fnKey = `add${node.type}`;
    (this as any)[fnKey](node);
  }
}

export function readTypeNodesFromSolidity(code: string): TypeNodeReaderResult {
  const types = new ParserTypes();
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
  const parseResult = parser.parse(code, { tolerant: true });
  parser.visit(parseResult, visitor);
  sortTypesByDependencies(types.parsedNodes);
  types.parsedNodes.forEach((node) => {
    types.addType(node);
  });
  return types.typeNodesByKind;
}

type RelevantDefinition =
  | StructDefinition
  | EnumDefinition
  | FunctionDefinition
  | CustomErrorDefinition
  | EventDefinition
  | StateVariableDeclaration
  | TypeDefinition;

type PotentialDependency = StructDefinition | EnumDefinition | TypeDefinition;

const extractUserDefinedTypeName = (typeName: TypeName): string | undefined => {
  if (typeName.type === "ArrayTypeName") {
    return extractUserDefinedTypeName(typeName.baseTypeName);
  }
  if (typeName.type === "UserDefinedTypeName") {
    return typeName.namePath;
  }
  return undefined;
};

const extractUserDefinedTypes = (fields: Array<{ typeName: TypeName | null }>): string[] => {
  const types: string[] = [];
  fields.forEach((field) => {
    if (!field.typeName) return;
    const typeName = extractUserDefinedTypeName(field.typeName);
    if (typeName) types.push(typeName);
  });
  return types;
};

function t(f: FunctionDefinition) {
  return staticNodeFactory.makeFunctionDefinition;
}

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

function sortTypesByDependencies(types: RelevantDefinition[]): void {
  // First pass - top level dependencies
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
