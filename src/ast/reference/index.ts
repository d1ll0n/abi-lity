/**
 * Reference types module — contains all Solidity reference/composite type nodes.
 *
 * Reference types are types that may be dynamically sized or dynamically encoded, and
 * are represented as pointers in memory. They use the head/tail encoding pattern in ABI
 * when they contain dynamic data.
 *
 * @see ReferenceType for the base class (used by BytesType/StringType).
 * @see TupleLikeType for the base of structs and tuples.
 * @see docs/type-system.md for the full type hierarchy documentation.
 */
import { ArrayType } from "./array_type";
import { BytesType, StringType } from "./packed_array_type";
import { StructType } from "./struct_type";
import { TupleType } from "./tuple_type";

export * from "./array_type";
export * from "./packed_array_type";
export * from "./struct_type";
export * from "./tuple_type";
export * from "./reference_type";

/** Discriminated union of all concrete reference type classes. */
export type UReferenceType = ArrayType | BytesType | StringType | StructType | TupleType;

/** Array of all concrete reference type constructors — used for runtime `instanceof` checks. */
export const PossibleReferenceTypes = [ArrayType, BytesType, StringType, StructType, TupleType];
