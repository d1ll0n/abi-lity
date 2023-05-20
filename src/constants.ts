export enum ArrayKind {
  Ordinary = "ordinary",
  Bytes = "bytes",
  String = "string"
}

export enum ABITypeKind {
  Bool = "bool",
  Byte = "byte",
  // Uint = "uint",
  Integer = "int",
  Address = "address",
  Enum = "enum",
  Array = "array",
  FixedBytes = "fixedBytes",
  Bytes = "bytes",
  // String = "string",
  Tuple = "tuple",
  Struct = "struct",
  Function = "function",
  Error = "error",
  Event = "event"
}

export enum EncodingScheme {
  SolidityMemory,
  ABI,
  // PackedABI,
  SuperPacked
}

export enum InternalDataType {
  Storage = "StorageSlot",
  Memory = "MemoryPointer",
  Calldata = "CalldataPointer",
  Returndata = "ReturndataPointer",
  Stack = "uint256"
}

export const InternalDataTypes = [
  InternalDataType.Storage,
  InternalDataType.Memory,
  InternalDataType.Calldata,
  InternalDataType.Returndata,
  InternalDataType.Stack
];
