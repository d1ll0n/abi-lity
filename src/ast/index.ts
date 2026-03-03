/**
 * AST module — abi-lity's type system for ABI-encodable Solidity types.
 *
 * This module defines the `TypeNode` hierarchy that represents every Solidity type
 * participating in ABI encoding. It is the central data structure used by all other
 * modules (readers, codegen, analysis).
 *
 * Key exports:
 * - `TypeNode` / `TypeNodeWithChildren` — Base classes with encoding metadata
 * - Value types: `IntegerType`, `BoolType`, `AddressType`, `FixedBytesType`, `EnumType`, etc.
 * - Reference types: `ArrayType`, `StructType`, `TupleType`, `BytesType`, `StringType`
 * - `UABIType` — Union of all concrete types; `isUABIType()` type guard
 * - `DefaultVisitor` — Visitor pattern for type dispatch
 * - `ASTContext` — Node registry for ID-based lookup
 *
 * @see docs/type-system.md for the full hierarchy and encoding semantics.
 * @see docs/architecture.md for how this module fits into the pipeline.
 */
import { isInstanceOf } from "solc-typed-ast";
import { PossibleReferenceTypes, UReferenceType } from "./reference";
import { TypeNode } from "./type_node";
import { PossibleValueTypes, UValueType } from "./value";

export * from "./reference";
export * from "./value";
export * from "./type_node";
export * from "./type_provider";
export * from "./ast_context";
export * from "./type_node_visitor";

/** Discriminated union of all concrete ABI-encodable type node classes. */
export type UABIType = UReferenceType | UValueType;

/** Array of all concrete type constructors — used for runtime `instanceof` checks. */
export const PossibleABITypes = [...PossibleValueTypes, ...PossibleReferenceTypes];

/** Type guard: returns `true` if `type` is a concrete ABI-encodable TypeNode. */
export const isUABIType = (type: TypeNode): type is UABIType => {
  return isInstanceOf(type, ...PossibleABITypes);
};
