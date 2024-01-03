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

export const isUValueType = (type: TypeNode): type is UValueType => {
  return isInstanceOf(type, ...PossibleValueTypes);
};
