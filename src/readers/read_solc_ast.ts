import {
  ArrayTypeName,
  assert,
  ASTSearch,
  ElementaryTypeName,
  EnumDefinition,
  ErrorDefinition,
  evalConstantExpr,
  EventDefinition,
  FunctionDefinition,
  FunctionTypeName,
  SourceUnit,
  StructDefinition,
  TypeName,
  UserDefinedTypeName,
  VariableDeclaration
} from "solc-typed-ast";
import {
  ArrayType,
  EnumType,
  ErrorType,
  EventType,
  FunctionType,
  StructType,
  TupleType,
  TypeNode,
  ASTContext
} from "../ast";
import { elementaryTypeStringToTypeNode } from "./elementary";
import { TypeNodeReaderResult } from "./types";

/**
 * Convert a given ast `TypeName` into a `TypeNode`. This produces "general
 * type patterns" without any specific storage information.
 *
 * @param astT - original AST `TypeName`
 * @returns equivalent `TypeNode`.
 *
 */
export function typeNameToTypeNode(astT: TypeName): TypeNode {
  if (astT instanceof ElementaryTypeName) {
    return elementaryTypeStringToTypeNode(astT.name);
  }

  if (astT instanceof ArrayTypeName) {
    const elT = typeNameToTypeNode(astT.vBaseType);

    let size: bigint | undefined;

    if (astT.vLength) {
      const result = evalConstantExpr(astT.vLength);

      assert(typeof result === "bigint", "Expected bigint for size of an array type", astT);

      size = result;
    }

    return new ArrayType(elT, size === undefined ? undefined : Number(size));
  }

  if (astT instanceof UserDefinedTypeName) {
    const def = astT.vReferencedDeclaration;

    if (def instanceof StructDefinition) {
      return structDefinitionToTypeNode(def);
    }
    if (def instanceof EnumDefinition) {
      return enumDefinitionToTypeNode(def);
    }

    throw new Error(`NYI typechecking of user-defined type ${def.print()}`);
  }

  if (astT instanceof FunctionTypeName) {
    const args = astT.vParameterTypes.vParameters.map((member) => {
      if (member.vType) {
        const parameter = typeNameToTypeNode(member.vType);
        parameter.labelFromParent = member.name;
        return parameter;
      }
      return undefined;
    });
    const rets = astT.vReturnParameterTypes.vParameters.map((member) => {
      if (member.vType) {
        const parameter = typeNameToTypeNode(member.vType);
        parameter.labelFromParent = member.name;
        return parameter;
      }
      return undefined;
    });
    if (!(args.every(Boolean) && rets.every(Boolean))) {
      throw Error("Some parameters have undefined types");
    }
    const parameters = new TupleType(args as TypeNode[]);
    const returnParameters = new TupleType(rets as TypeNode[]);

    return new FunctionType(
      "",
      parameters,
      returnParameters,
      astT.visibility,
      astT.stateMutability
    );
  }

  throw new Error(`NYI converting AST Type ${astT.print()} to SType`);
}

function convertVariableDeclarations(variables: VariableDeclaration[]): TypeNode[] {
  const members = variables.map((member) => {
    if (member.vType) {
      const parameter = typeNameToTypeNode(member.vType);
      parameter.labelFromParent = member.name;
      return parameter;
    }
    return undefined;
  });
  if (!members.every(Boolean)) {
    throw Error(`Some variables have no defined type`);
  }
  return members as TypeNode[];
}

export function functionDefinitionToTypeNode(ast: FunctionDefinition): FunctionType {
  const parameters = convertVariableDeclarations(ast.vParameters.vParameters);
  const returnParameters = convertVariableDeclarations(ast.vReturnParameters.vParameters);

  return new FunctionType(
    ast.name,
    parameters.length ? new TupleType(parameters) : undefined,
    returnParameters.length ? new TupleType(returnParameters) : undefined,
    ast.visibility,
    ast.stateMutability
  );
}

export function enumDefinitionToTypeNode(ast: EnumDefinition): EnumType {
  return new EnumType(
    ast.name,
    ast.vMembers.map((member) => member.name)
  );
}

export function structDefinitionToTypeNode(ast: StructDefinition): StructType {
  const members = convertVariableDeclarations(ast.vMembers);
  return new StructType(members, ast.name);
}

export function eventDefinitionToTypeNode(ast: EventDefinition): EventType {
  const members = convertVariableDeclarations(ast.vParameters.vParameters);
  return new EventType(ast.name, members.length ? new TupleType(members) : undefined);
}

export function errorDefinitionToTypeNode(ast: ErrorDefinition): ErrorType {
  const members = convertVariableDeclarations(ast.vParameters.vParameters);
  return new ErrorType(ast.name, members.length ? new TupleType(members) : undefined);
}

export function readTypeNodesFromSolcAST(...sourceUnits: SourceUnit[]): TypeNodeReaderResult {
  const search = ASTSearch.from(sourceUnits);
  const context = new ASTContext();
  const structs = search.find("StructDefinition").map(structDefinitionToTypeNode);
  const functions = search.find("FunctionDefinition").map(functionDefinitionToTypeNode);
  const events = search.find("EventDefinition").map(eventDefinitionToTypeNode);
  const errors = search.find("ErrorDefinition").map(errorDefinitionToTypeNode);
  const enums = search.find("EnumDefinition").map(enumDefinitionToTypeNode);
  [...functions, ...events, ...errors, ...enums].forEach((node) => {
    node.context = context;
  });
  return {
    context,
    functions,
    events,
    errors,
    structs,
    enums
  };
}
