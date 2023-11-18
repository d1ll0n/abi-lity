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
  Event = "event",
  UserDefined = "userDefined"
}

export enum EncodingScheme {
  SolidityMemory,
  ABI,
  // PackedABI,
  SuperPacked
}

export enum DataLocation {
  Storage = "StorageSlot",
  Memory = "MemoryPointer",
  Calldata = "CalldataPointer",
  Returndata = "ReturndataPointer",
  Stack = "uint256"
}

export const DataLocations = [
  DataLocation.Storage,
  DataLocation.Memory,
  DataLocation.Calldata,
  DataLocation.Returndata,
  DataLocation.Stack
];
