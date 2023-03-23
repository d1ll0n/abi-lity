import { bigIntToHex, bufferToBigInt, padToEven, toChecksumAddress } from "@ethereumjs/util";
import {
  AddressType,
  ArrayType,
  BoolType,
  BytesType,
  EnumType,
  FunctionType,
  IntegerType,
  ReferenceType,
  StringType,
  StructType,
  TupleType,
  TypeNode,
  ValueType
} from "../ast";
import { FixedBytesType } from "../ast/value/fixed_bytes_type";

export type DefaultValue = string | boolean | DefaultValue[] | { [key: string]: DefaultValue };

function getDefaultForValueType(type: ValueType, i: number): DefaultValue {
  if (type instanceof EnumType) {
    return `0x${padToEven((i % type.members.length).toString(16))}`;
  }
  if (type instanceof AddressType)
    return toChecksumAddress(`0x${i.toString(16).padStart(40, "0")}`);
  if (type instanceof BoolType) return Boolean(i % 2);
  if (type instanceof FixedBytesType) {
    return `0x${i
      .toString(16)
      .padStart(type.size * 2, "0")
      .slice(0, type.size * 2)}`;
  }
  if (type instanceof IntegerType) {
    const positive = !type.signed || i % 2;
    const bi = bufferToBigInt(
      Buffer.from(
        i
          .toString(16)
          .padStart(type.exactBits / 4, "0")
          .slice(0, type.exactBits / 4),
        "hex"
      )
    );
    const hex = bigIntToHex(bi);
    const prefix = positive ? "" : "-";
    return `${prefix}${hex}`;
  }
  throw Error(`Unrecognized type ${type.kind}`);
}

export function getDefaultForReferenceType(type: ReferenceType, i?: number): DefaultValue {
  if (type instanceof BytesType) return `0x${padToEven("a".repeat(i ?? 0))}`;
  if (type instanceof StringType) return `0x${padToEven("a".repeat(i ?? 0))}`;
  if (type instanceof ArrayType) {
    const length = type.length ?? (i === undefined ? 0 : i);
    return new Array(length)
      .fill(null)
      .map((_, j) => getDefaultForType(type.baseType, i === undefined ? i : i + j));
  }
  if (type instanceof StructType) {
    return type.vMembers.reduce(
      (obj, field, j) => ({
        ...obj,
        [field.labelFromParent ?? field.identifier]: getDefaultForType(
          field,
          i === undefined ? i : i + j
        )
      }),
      {}
    );
  }
  if (type instanceof TupleType)
    return type.vMembers.map((member, j) => getDefaultForType(member, i === undefined ? i : i + j));
  throw Error(`Unrecognized type ${type.kind}`);
}

export function getDefaultForType(type: TypeNode, i?: number): DefaultValue {
  if (type instanceof ValueType) {
    if (type instanceof FunctionType) {
      if (!type.parameters) return [];
      return getDefaultForType(type.parameters as TupleType, i);
    }
    return getDefaultForValueType(type, i ?? 0);
  }
  return getDefaultForReferenceType(type, i);
}
