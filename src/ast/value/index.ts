/**
 * Value types module — contains all Solidity value type nodes.
 *
 * Value types are types that always fit in a single 32-byte EVM word in ABI encoding.
 * They are never dynamically encoded and have no tail section. All value types are
 * right-aligned in the word except `FixedBytesType` (which is left-aligned in solc,
 * though abi-lity handles this distinction in codegen).
 *
 * @see ValueType for the base class contract.
 * @see docs/type-system.md for the full type hierarchy documentation.
 */
import { AddressType } from "./address_type";
import { BoolType } from "./bool_type";
import { ContractType } from "./contract_type";
import { EnumType } from "./enum_type";
import { FixedBytesType } from "./fixed_bytes_type";
import { FunctionType } from "./function_type";
import { IntegerType } from "./integer_type";
import { ErrorType } from "./error_type";
import { EventType } from "./event_type";
import { TypeNode } from "../type_node";
import { isInstanceOf } from "solc-typed-ast";

export * from "./address_type";
export * from "./bool_type";
export * from "./enum_type";
export * from "./fixed_bytes_type";
export * from "./integer_type";
export * from "./value_type";
export * from "./function_type";
export * from "./error_type";
export * from "./event_type";
export * from "./contract_type";

/** Discriminated union of all concrete value type classes. */
export type UValueType =
  | AddressType
  | BoolType
  | ContractType
  | EnumType
  | ErrorType
  | EventType
  | FixedBytesType
  | FunctionType
  | IntegerType;

/** Array of all concrete value type constructors — used for runtime `instanceof` checks. */
export const PossibleValueTypes = [
  AddressType,
  BoolType,
  ContractType,
  EnumType,
  ErrorType,
  EventType,
  FixedBytesType,
  FunctionType,
  IntegerType
];

/** Type guard: returns `true` if `type` is one of the concrete value types. */
export const isUValueType = (type: TypeNode): type is UValueType => {
  return isInstanceOf(type, ...PossibleValueTypes);
};
