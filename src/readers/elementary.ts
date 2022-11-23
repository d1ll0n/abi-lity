import {
  AddressType,
  BoolType,
  BytesType,
  FixedBytesType,
  IntegerType,
  StringType,
  TypeNode
} from "../ast";

export function elementaryTypeStringToTypeNode(typeName: string): TypeNode {
  const name = typeName.trim();

  if (name === "bool") {
    return new BoolType();
  }

  const rxAddress = /^address *(payable)?$/;

  if (rxAddress.test(name)) {
    return new AddressType();
  }

  const rxInt = /^(u?)int([0-9]*)$/;

  let m = name.match(rxInt);

  if (m !== null) {
    const signed = m[1] !== "u";
    const nBits = m[2] === "" ? 256 : parseInt(m[2]);

    return new IntegerType(nBits, signed);
  }

  const rxFixedBytes = /^bytes([0-9]+)$/;

  m = name.match(rxFixedBytes);

  if (m !== null) {
    const size = parseInt(m[1]);

    return new FixedBytesType(size);
  }

  if (name === "byte") {
    return new FixedBytesType(1);
  }

  if (name === "bytes") {
    return new BytesType();
  }

  if (name === "string") {
    return new StringType();
  }

  throw new Error(`NYI converting elementary AST Type ${name}`);
}
