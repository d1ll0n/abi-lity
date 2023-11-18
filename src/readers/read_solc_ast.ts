import {
  ArrayTypeName,
  assert,
  ASTSearch,
  ContractDefinition,
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
  VariableDeclaration,
  Expression,
  FunctionCall,
  InferType,
  LatestCompilerVersion,
  UserDefinedValueTypeDefinition
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
  ASTContext,
  AddressType,
  BoolType,
  BytesType,
  FixedBytesType,
  IntegerType,
  StringType,
  ContractType,
  ValueType
} from "../ast";
import { elementaryTypeStringToTypeNode } from "./elementary";
import { TypeNodeReaderResult } from "./types";
import { isExternalFunction } from "../utils";

/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { AddressType as SolcAddressType } from "solc-typed-ast/dist/types/ast/address";
import { ArrayType as SolcArrayType } from "solc-typed-ast/dist/types/ast/array";
import { BoolType as SolcBoolType } from "solc-typed-ast/dist/types/ast/bool";
import { FixedBytesType as SolcFixedBytesType } from "solc-typed-ast/dist/types/ast/fixed_bytes";
import { BytesType as SolcBytesType } from "solc-typed-ast/dist/types/ast/bytes";
import { ErrorType as SolcErrorType } from "solc-typed-ast/dist/types/ast/error_type";
import { EventType as SolcEventType } from "solc-typed-ast/dist/types/ast/event_type";
import { IntType as SolcIntType } from "solc-typed-ast/dist/types/ast/int_type";
import { IntLiteralType as SolcIntLiteralType } from "solc-typed-ast/dist/types/ast/int_literal";
import { PointerType as SolcPointerType } from "solc-typed-ast/dist/types/ast/pointer";
import { BuiltinFunctionType as SolcBuiltinFunctionType } from "solc-typed-ast/dist/types/ast/builtin_function";
import { BuiltinStructType as SolcBuiltinStructType } from "solc-typed-ast/dist/types/ast/builtin_struct_type";
import { BuiltinType as SolcBuiltinType } from "solc-typed-ast/dist/types/ast/builtin_type";
import { FunctionLikeType as SolcFunctionLikeType } from "solc-typed-ast/dist/types/ast/function_like_type";
import { FunctionType as SolcFunctionType } from "solc-typed-ast/dist/types/ast/function_type";
import { ImportRefType as SolcImportRefType } from "solc-typed-ast/dist/types/ast/import_ref_type";
import { MappingType as SolcMappingType } from "solc-typed-ast/dist/types/ast/mapping_type";
import { ModifierType as SolcModifierType } from "solc-typed-ast/dist/types/ast/modifier_type";
import { ModuleType as SolcModuleType } from "solc-typed-ast/dist/types/ast/module_type";
import { NumericLiteralType as SolcNumericLiteralType } from "solc-typed-ast/dist/types/ast/numeric_literal";
import { StringType as SolcStringType } from "solc-typed-ast/dist/types/ast/string";
import { StringLiteralType as SolcStringLiteralType } from "solc-typed-ast/dist/types/ast/string_literal";
import { SuperType as SolcSuperType } from "solc-typed-ast/dist/types/ast/super";
import { TupleType as SolcTupleType } from "solc-typed-ast/dist/types/ast/tuple_type";
import { TypeNameType as SolcTypeNameType } from "solc-typed-ast/dist/types/ast/typename_type";
import { UserDefinedType as SolcUserDefinedType } from "solc-typed-ast/dist/types/ast/user_defined_type";
import { U256Type as SolcU256Type } from "solc-typed-ast/dist/types/ast/u256_type";
import { UserDefinedValueType } from "../ast/value/user_defined_value_type";
// import { InternalType as SolcInternalType } from "solc-typed-ast/dist/types/ast/internal";
// import { RationalLiteralType as SolcRationalLiteralType } from "solc-typed-ast/dist/types/ast/rational_literal";
// import { TypeNode as SolcTypeNode } from "solc-typed-ast/dist/types/ast/type";
// import { YulBuiltinFunctionType as SolcYulBuiltinFunctionType } from "solc-typed-ast/dist/types/ast/yul_builtin_function";
// import { PackedArrayType as SolcPackedArrayType } from "solc-typed-ast/dist/types/ast/packed_array_type";
// import { YulFunctionType as SolcYulFunctionType } from "solc-typed-ast/dist/types/ast/yul_function_type";

type SolcTypeNode =
  | SolcUserDefinedType
  | SolcTypeNameType
  | SolcAddressType
  | SolcBoolType
  | SolcIntType
  | SolcFixedBytesType
  | SolcIntLiteralType
  | SolcNumericLiteralType
  | SolcU256Type
  | SolcStringType
  | SolcStringLiteralType
  | SolcBytesType
  | SolcArrayType
  | SolcPointerType
  | SolcErrorType
  | SolcEventType
  | SolcTupleType
  | SolcFunctionType
  | SolcBuiltinFunctionType
  | SolcBuiltinStructType
  | SolcBuiltinType
  | SolcFunctionLikeType
  | SolcImportRefType
  | SolcMappingType
  | SolcModifierType
  | SolcModuleType
  | SolcSuperType;

function UserDefinedTypeToTypeNode(type: SolcUserDefinedType) {
  const def = type.definition;
  if (def instanceof StructDefinition) {
    return structDefinitionToTypeNode(def);
  }
  if (def instanceof EnumDefinition) {
    return enumDefinitionToTypeNode(def);
  }
  if (def instanceof ContractDefinition) {
    return new ContractType(def.name);
  }
  throw Error(`Unrecognized user defined type ${def.print()}`);
}

const Infer = new InferType(LatestCompilerVersion);

export function typeOfExpression(expr: Expression): TypeNode {
  return solcTypeNodeToTypeNode(Infer.typeOf(expr));
}
export function typeOfFunctionCallArguments(expr: FunctionCall): TupleType {
  return new TupleType(expr.vArguments.map((arg) => typeOfExpression(arg)));
}

export function solcTypeNodeToTypeNode(type: SolcTypeNode): TypeNode {
  if (type instanceof SolcUserDefinedType) return UserDefinedTypeToTypeNode(type);
  if (type instanceof SolcTypeNameType) return solcTypeNodeToTypeNode(type.type);
  if (type instanceof SolcAddressType) return new AddressType(type.payable);
  if (type instanceof SolcBoolType) return new BoolType();
  if (type instanceof SolcIntType) return new IntegerType(type.nBits, type.signed);
  if (type instanceof SolcFixedBytesType) return new FixedBytesType(type.size);
  if (type instanceof SolcIntLiteralType) {
    return solcTypeNodeToTypeNode(type.smallestFittingType()!);
  }
  if (type instanceof SolcNumericLiteralType) {
    return new IntegerType(256, false);
  }

  if (type instanceof SolcU256Type) return new IntegerType(256, false);
  if (type instanceof SolcStringType) return new StringType();
  if (type instanceof SolcStringLiteralType) return new StringType();
  if (type instanceof SolcBytesType) return new BytesType();
  if (type instanceof SolcArrayType) {
    return new ArrayType(
      solcTypeNodeToTypeNode(type.elementT),
      type.size !== undefined ? Number(type.size) : undefined
    );
  }
  if (type instanceof SolcPointerType) {
    return solcTypeNodeToTypeNode(type.to);
  }
  if (type instanceof SolcErrorType) {
    const parameters =
      type.parameters.length > 0
        ? new TupleType(type.parameters.map((p) => solcTypeNodeToTypeNode(p)))
        : undefined;
    return new ErrorType(type.name!, parameters);
  }
  if (type instanceof SolcEventType) {
    const parameters =
      type.parameters.length > 0
        ? new TupleType(type.parameters.map((p) => solcTypeNodeToTypeNode(p)))
        : undefined;
    return new EventType(type.name!, parameters);
  }
  if (type instanceof SolcTupleType) {
    return new TupleType(type.elements.map((c) => solcTypeNodeToTypeNode(c)));
  }
  if (type instanceof SolcFunctionType) {
    const parameters =
      type.parameters.length > 0
        ? new TupleType(type.parameters.map((p) => solcTypeNodeToTypeNode(p)))
        : undefined;
    const returnParameters =
      type.returns.length > 0
        ? new TupleType(type.returns.map((p) => solcTypeNodeToTypeNode(p)))
        : undefined;
    new FunctionType(type.name!, parameters, returnParameters, type.visibility, type.mutability);
  }
  throw Error(`Not supported: resolving TypeNode for ${type.constructor.name}`);
}

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
    if (def instanceof ContractDefinition) {
      return new ContractType(def.name);
    }
    if (def instanceof FunctionDefinition) {
      return functionDefinitionToTypeNode(def);
    }
    if (def instanceof UserDefinedValueTypeDefinition) {
      return new UserDefinedValueType(
        def.name,
        typeNameToTypeNode(def.underlyingType) as ValueType
      );
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
  const members = variables.map((member, i) => {
    if (member.vType) {
      const parameter = typeNameToTypeNode(member.vType);
      parameter.labelFromParent = member.name || `param${i}`;
      parameter.isIndexed = member.indexed;
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
  return new StructType(members, ast.name, ast.canonicalName);
}

export function eventDefinitionToTypeNode(ast: EventDefinition): EventType {
  const members = convertVariableDeclarations(ast.vParameters.vParameters);
  return new EventType(
    ast.name,
    members.length ? new TupleType(members) : undefined,
    ast.anonymous
  );
}

export function errorDefinitionToTypeNode(ast: ErrorDefinition): ErrorType {
  const members = convertVariableDeclarations(ast.vParameters.vParameters);
  return new ErrorType(ast.name, members.length ? new TupleType(members) : undefined);
}

type ASTDefinition =
  | FunctionDefinition
  | EnumDefinition
  | StructDefinition
  | EventDefinition
  | ErrorDefinition;

export type ASTDefinitionToTypeNode<T extends ASTDefinition> = T extends FunctionDefinition
  ? FunctionType
  : T extends EnumDefinition
  ? EnumType
  : T extends StructDefinition
  ? StructType
  : T extends EventDefinition
  ? EventType
  : ErrorType;

function astDefinitionToTypeNode(ast: FunctionDefinition): FunctionType;
function astDefinitionToTypeNode(ast: EnumDefinition): EnumType;
function astDefinitionToTypeNode(ast: StructDefinition): StructType;
function astDefinitionToTypeNode(ast: EventDefinition): EventType;
function astDefinitionToTypeNode(ast: ErrorDefinition): ErrorType;
function astDefinitionToTypeNode(
  ast: FunctionDefinition | EnumDefinition | StructDefinition | EventDefinition | ErrorDefinition
): FunctionType | EnumType | StructType | EventType | ErrorType {
  if (ast instanceof FunctionDefinition) {
    return functionDefinitionToTypeNode(ast);
  } else if (ast instanceof EnumDefinition) {
    return enumDefinitionToTypeNode(ast);
  } else if (ast instanceof StructDefinition) {
    return structDefinitionToTypeNode(ast);
  } else if (ast instanceof EventDefinition) {
    return eventDefinitionToTypeNode(ast);
  }
  return errorDefinitionToTypeNode(ast);
}

export { astDefinitionToTypeNode };

export function readTypeNodesFromSolcAST(
  disableInternalFunctions: boolean,
  ...sourceUnits: SourceUnit[]
): TypeNodeReaderResult {
  const search = ASTSearch.from(sourceUnits);
  const context = new ASTContext();
  const structs = search.find("StructDefinition").map((s) => astDefinitionToTypeNode(s));
  const functions = search
    .find("FunctionDefinition")
    .filter((x) => !disableInternalFunctions || isExternalFunction(x))
    .map((s) => astDefinitionToTypeNode(s));
  const events = search.find("EventDefinition").map((s) => astDefinitionToTypeNode(s));
  const errors = search.find("ErrorDefinition").map((s) => astDefinitionToTypeNode(s));
  const enums = search.find("EnumDefinition").map((s) => astDefinitionToTypeNode(s));
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
