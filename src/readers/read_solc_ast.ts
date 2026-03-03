/**
 * Core bridge between solc-typed-ast and abi-lity's TypeNode system.
 *
 * This module converts solc-typed-ast's AST nodes and inferred types into abi-lity's
 * `TypeNode` representation. It is the primary input path for compiled Solidity code
 * and provides the most complete type information (full type inference, constant
 * expression evaluation, inherited types, etc.).
 *
 * Key functions:
 * - `solcTypeNodeToTypeNode()` — Converts solc's inferred types to abi-lity TypeNodes
 * - `typeNameToTypeNode()` — Converts AST TypeName nodes to TypeNodes
 * - `*DefinitionToTypeNode()` — Convert specific definition nodes (function, struct, etc.)
 * - `readTypeNodesFromSolcAST()` — Main entry point for extracting all types from SourceUnits
 * - `readTypeNodesFromContractInterface()` — Extracts only the public/external interface
 *
 * @see docs/readers.md for the full module guide.
 * @see notes/solc-typed-ast.md for how abi-lity uses solc-typed-ast.
 */
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
  UserDefinedValueTypeDefinition,
  FunctionVisibility
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

/*
 * solc-typed-ast internal type imports.
 * These are the inferred type classes from solc's type system, imported with `Solc` prefix
 * to distinguish them from abi-lity's identically-named TypeNode classes.
 */
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
import { NumericLiteralType as SolcNumericLiteralType } from "solc-typed-ast/dist/types/ast/numeric_literal";
import { StringType as SolcStringType } from "solc-typed-ast/dist/types/ast/string";
import { StringLiteralType as SolcStringLiteralType } from "solc-typed-ast/dist/types/ast/string_literal";
import { SuperType as SolcSuperType } from "solc-typed-ast/dist/types/ast/super";
import { TupleType as SolcTupleType } from "solc-typed-ast/dist/types/ast/tuple_type";
import { TypeNameType as SolcTypeNameType } from "solc-typed-ast/dist/types/ast/typename_type";
import { UserDefinedType as SolcUserDefinedType } from "solc-typed-ast/dist/types/ast/user_defined_type";
import { U256Type as SolcU256Type } from "solc-typed-ast/dist/types/ast/u256_type";
import { UserDefinedValueType } from "../ast/value/user_defined_value_type";
import _ from "lodash";
import { getEmitsByEvent, getRevertsByError } from "../codegen/coders/generate";
// import { InternalType as SolcInternalType } from "solc-typed-ast/dist/types/ast/internal";
// import { RationalLiteralType as SolcRationalLiteralType } from "solc-typed-ast/dist/types/ast/rational_literal";
// import { TypeNode as SolcTypeNode } from "solc-typed-ast/dist/types/ast/type";
// import { YulBuiltinFunctionType as SolcYulBuiltinFunctionType } from "solc-typed-ast/dist/types/ast/yul_builtin_function";
// import { PackedArrayType as SolcPackedArrayType } from "solc-typed-ast/dist/types/ast/packed_array_type";
// import { YulFunctionType as SolcYulFunctionType } from "solc-typed-ast/dist/types/ast/yul_function_type";

/**
 * Union of all solc-typed-ast inferred type classes that `solcTypeNodeToTypeNode()` may encounter.
 * Includes both convertible types (value types, arrays, tuples, etc.) and unsupported types
 * (modifiers, builtins, etc.) that will throw if encountered.
 */
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
  | SolcSuperType;

/**
 * Converts a `SolcUserDefinedType` to the appropriate abi-lity TypeNode by dispatching
 * on the underlying definition (struct, enum, or contract).
 */
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

/** Shared InferType instance for resolving expression types. */
const Infer = new InferType(LatestCompilerVersion);

/**
 * Infers the type of a solc-typed-ast `Expression` and converts it to an abi-lity TypeNode.
 * Uses solc-typed-ast's `InferType` to get the semantic type, then converts via `solcTypeNodeToTypeNode()`.
 */
export function typeOfExpression(expr: Expression): TypeNode {
  return solcTypeNodeToTypeNode(Infer.typeOf(expr));
}

/**
 * Returns a `TupleType` containing the inferred types of all arguments in a `FunctionCall`.
 */
export function typeOfFunctionCallArguments(expr: FunctionCall): TupleType {
  return new TupleType(expr.vArguments.map((arg) => typeOfExpression(arg)));
}

/**
 * Converts a solc-typed-ast inferred type to an abi-lity TypeNode.
 *
 * This is the core type conversion function. It dispatches on the runtime class of the
 * solc type and recursively builds the equivalent abi-lity TypeNode tree. Handles
 * 20+ type variants grouped into:
 * - **User-defined types**: structs, enums, contracts → dispatch to definition converters
 * - **Value types**: bool, address, int, fixedBytes → direct construction
 * - **Literal types**: int literals, numeric literals, string literals → resolved to concrete types
 * - **Reference types**: arrays, tuples → recursive conversion of element/member types
 * - **Compound types**: functions, errors, events → full parameter mapping
 * - **Wrapper types**: PointerType, TypeNameType → unwrap and recurse
 *
 * @param type - A solc-typed-ast inferred type (from `InferType.typeOf()`)
 * @param context - Optional ASTContext to register the created node in
 * @returns The equivalent abi-lity TypeNode
 * @throws For unsupported types (ModifierType, BuiltinFunctionType, etc.)
 *
 * @see docs/readers.md for the full conversion table.
 */
export function solcTypeNodeToTypeNode(type: SolcTypeNode, context?: ASTContext): TypeNode {
  let node: TypeNode;

  // --- User-defined types: dispatch to definition-specific converters ---
  if (type instanceof SolcUserDefinedType) node = UserDefinedTypeToTypeNode(type);

  // --- Wrapper types: unwrap and recurse ---
  else if (type instanceof SolcTypeNameType) node = solcTypeNodeToTypeNode(type.type);
  else if (type instanceof SolcPointerType) {
    // PointerType wraps a type with a DataLocation — discard the location, keep the type
    node = solcTypeNodeToTypeNode(type.to);
  }

  // --- Value types: direct construction ---
  else if (type instanceof SolcAddressType) node = new AddressType(type.payable);
  else if (type instanceof SolcBoolType) node = new BoolType();
  else if (type instanceof SolcIntType) node = new IntegerType(type.nBits, type.signed);
  else if (type instanceof SolcFixedBytesType) node = new FixedBytesType(type.size);

  // --- Literal types: resolve to concrete types ---
  else if (type instanceof SolcIntLiteralType) {
    // Int literals resolve to the smallest integer type that fits the value
    node = solcTypeNodeToTypeNode(type.smallestFittingType()!);
  } else if (type instanceof SolcNumericLiteralType) {
    node = new IntegerType(256, false);
  } else if (type instanceof SolcU256Type) node = new IntegerType(256, false);
  else if (type instanceof SolcStringType) node = new StringType();
  else if (type instanceof SolcStringLiteralType) node = new StringType();
  else if (type instanceof SolcBytesType) node = new BytesType();

  // --- Reference types: recursive conversion ---
  else if (type instanceof SolcArrayType) {
    node = new ArrayType(
      solcTypeNodeToTypeNode(type.elementT),
      type.size !== undefined ? Number(type.size) : undefined
    );
  } else if (type instanceof SolcTupleType) {
    node = new TupleType(type.elements.map((c) => solcTypeNodeToTypeNode(c as SolcTypeNode)));
  }

  // --- Compound types: full parameter mapping ---
  else if (type instanceof SolcErrorType) {
    const parameters =
      type.parameters.length > 0
        ? new TupleType(type.parameters.map((p) => solcTypeNodeToTypeNode(p)))
        : undefined;
    node = new ErrorType(type.name!, parameters);
  } else if (type instanceof SolcEventType) {
    const parameters =
      type.parameters.length > 0
        ? new TupleType(type.parameters.map((p) => solcTypeNodeToTypeNode(p)))
        : undefined;
    node = new EventType(type.name!, parameters);
  } else if (type instanceof SolcFunctionType) {
    const parameters =
      type.parameters.length > 0
        ? new TupleType(type.parameters.map((p) => solcTypeNodeToTypeNode(p)))
        : undefined;
    const returnParameters =
      type.returns.length > 0
        ? new TupleType(type.returns.map((p) => solcTypeNodeToTypeNode(p)))
        : undefined;
    node = new FunctionType(
      type.name!,
      parameters,
      returnParameters,
      type.visibility,
      type.mutability
    );
  }

  // --- Unsupported types ---
  else {
    throw Error(`Not supported: resolving TypeNode for ${type.constructor.name}`);
  }

  if (context) node.context = context;
  return node;
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
      const result = evalConstantExpr(astT.vLength, Infer);

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

/**
 * Converts an array of solc-typed-ast `VariableDeclaration` nodes to abi-lity TypeNodes.
 *
 * Preserves the parameter name as `labelFromParent` (falls back to `param<index>`) and
 * the `indexed` flag (for event parameters). Throws if any variable has no type.
 */
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

/**
 * Converts a `FunctionDefinition` to a `FunctionType`.
 *
 * Extracts parameters, return parameters, visibility, state mutability, and NatSpec
 * documentation from the AST node.
 */
export function functionDefinitionToTypeNode(
  ast: FunctionDefinition,
  context?: ASTContext
): FunctionType {
  const parameters = convertVariableDeclarations(ast.vParameters.vParameters);
  const returnParameters = convertVariableDeclarations(ast.vReturnParameters.vParameters);

  const type = new FunctionType(
    ast.name,
    parameters.length ? new TupleType(parameters) : undefined,
    returnParameters.length ? new TupleType(returnParameters) : undefined,
    ast.visibility,
    ast.stateMutability,
    ast.documentation
  );
  if (context) type.context = context;
  return type;
}

/** Converts an `EnumDefinition` to an `EnumType`, preserving member names and documentation. */
export function enumDefinitionToTypeNode(ast: EnumDefinition, context?: ASTContext): EnumType {
  const type = new EnumType(
    ast.name,
    ast.vMembers.map((member) => member.name),
    ast.documentation
  );
  if (context) type.context = context;
  return type;
}

/**
 * Converts a `StructDefinition` to a `StructType`.
 * Preserves the struct name, canonical name (qualified with contract name), and documentation.
 */
export function structDefinitionToTypeNode(
  ast: StructDefinition,
  context?: ASTContext
): StructType {
  const members = convertVariableDeclarations([...ast.vMembers]);
  const type = new StructType(members, ast.name, ast.canonicalName, ast.documentation);
  if (context) type.context = context;
  return type;
}

/** Converts an `EventDefinition` to an `EventType`, preserving the anonymous flag and documentation. */
export function eventDefinitionToTypeNode(ast: EventDefinition, context?: ASTContext): EventType {
  const members = convertVariableDeclarations(ast.vParameters.vParameters);
  const type = new EventType(
    ast.name,
    members.length ? new TupleType(members) : undefined,
    ast.anonymous,
    ast.documentation
  );
  if (context) type.context = context;
  return type;
}

/** Converts an `ErrorDefinition` to an `ErrorType` with optional parameters and documentation. */
export function errorDefinitionToTypeNode(ast: ErrorDefinition, context?: ASTContext): ErrorType {
  const members = convertVariableDeclarations(ast.vParameters.vParameters);
  const type = new ErrorType(
    ast.name,
    members.length ? new TupleType(members) : undefined,
    ast.documentation
  );
  if (context) type.context = context;
  return type;
}

/** Union of solc-typed-ast definition node types that can be converted to TypeNodes. */
type ASTDefinition =
  | FunctionDefinition
  | EnumDefinition
  | StructDefinition
  | EventDefinition
  | ErrorDefinition;

/** Maps an `ASTDefinition` subtype to its corresponding abi-lity TypeNode type. */
export type ASTDefinitionToTypeNode<T extends ASTDefinition> = T extends FunctionDefinition
  ? FunctionType
  : T extends EnumDefinition
  ? EnumType
  : T extends StructDefinition
  ? StructType
  : T extends EventDefinition
  ? EventType
  : ErrorType;

/**
 * Type-safe dispatcher: converts any `ASTDefinition` to its corresponding TypeNode.
 * Uses function overloads to provide exact return types for each definition kind.
 */
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

/**
 * Main entry point: extracts all type definitions from compiled solc-typed-ast SourceUnits.
 *
 * Finds all function, struct, event, error, and enum definitions across the given
 * source units and converts them to abi-lity TypeNodes.
 *
 * @param disableInternalFunctions - If `true`, only external/public functions are included.
 *   Internal and private functions are filtered out.
 * @param sourceUnits - One or more `SourceUnit` nodes from solc-typed-ast's `ASTReader.read()`.
 * @returns A `TypeNodeReaderResult` with categorized type nodes and a shared `ASTContext`.
 */
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

/**
 * Extracts only the public/external interface from a contract's AST.
 *
 * Unlike `readTypeNodesFromSolcAST()` (which extracts all definitions), this function:
 * 1. Only includes external and public functions
 * 2. Discovers events emitted at runtime via `getEmitsByEvent()` (not just declared events)
 * 3. Discovers errors reverted at runtime via `getRevertsByError()`
 * 4. Deduplicates all types by signature using lodash `uniqBy()`
 * 5. Collects enums and structs that were registered in the context during conversion
 *    (catching types referenced transitively through function parameters)
 *
 * @param search - An `ASTSearch` instance over the contract's source units.
 */
export function readTypeNodesFromContractInterface(search: ASTSearch): TypeNodeReaderResult {
  const context = new ASTContext();
  const functions = [
    ...search.findFunctionsByVisibility(FunctionVisibility.External),
    ...search.findFunctionsByVisibility(FunctionVisibility.Public)
  ].map((s) => functionDefinitionToTypeNode(s, context));
  const events = _.uniqBy(
    [
      ...search.find("EventDefinition").map((e) => eventDefinitionToTypeNode(e, context)),
      ...getEmitsByEvent(search).map(([type]) => type)
    ],
    (x) => x.signatureInExternalFunction(false)
  );
  const errors = _.uniqBy(
    [
      ...search.find("ErrorDefinition").map((e) => errorDefinitionToTypeNode(e, context)),
      ...getRevertsByError(search).map(([type]) => type)
    ],
    (x) => x.signatureInExternalFunction(false)
  );
  const enums = _.uniqBy(
    [
      ...search.find("EnumDefinition").map((s) => enumDefinitionToTypeNode(s, context)),
      ...context.getNodesBySelector<EnumType>((s) => s instanceof EnumType)
    ],
    (x) => x.name
  );
  const structs = _.uniqBy(
    [
      ...search.find("StructDefinition").map((s) => structDefinitionToTypeNode(s, context)),
      ...context.getNodesBySelector<StructType>((s) => s instanceof StructType)
    ],
    (x) => x.signatureInExternalFunction(false)
  );
  // const events =
  // const structs = search.find("StructDefinition").map((s) => astDefinitionToTypeNode(s));
  // const functions = search
  // .find("FunctionDefinition")
  // .filter((x) => isExternalFunction(x))
  // .map((s) => astDefinitionToTypeNode(s));
  // const events = search.find("EventDefinition").map((s) => astDefinitionToTypeNode(s));
  // const errors = search.find("ErrorDefinition").map((s) => astDefinitionToTypeNode(s));
  // const enums = search.find("EnumDefinition").map((s) => astDefinitionToTypeNode(s));
  [...functions, ...events, ...errors, ...enums, ...structs].forEach((node) => {
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
