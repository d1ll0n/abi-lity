/**
 * Elementary type string parser — shared by `read_abi.ts` and `read_code.ts`.
 *
 * @see docs/readers.md for the full parsing chain.
 */
import {
  AddressType,
  BoolType,
  BytesType,
  FixedBytesType,
  IntegerType,
  StringType,
  TypeNode
} from "../ast";

/**
 * Converts a Solidity elementary type name string to the corresponding TypeNode.
 *
 * Parsing chain (first match wins):
 * 1. `"bool"` → `BoolType`
 * 2. `"address"` / `"address payable"` → `AddressType`
 * 3. `"uint256"` / `"int8"` / `"int"` (no width → 256) → `IntegerType(nBits, signed)`
 * 4. `"bytes32"` / `"bytes1"` etc. → `FixedBytesType(size)`
 * 5. `"byte"` → `FixedBytesType(1)` (Solidity <0.8 alias)
 * 6. `"bytes"` → `BytesType` (dynamic)
 * 7. `"string"` → `StringType`
 *
 * @throws If the type name doesn't match any known elementary type
 */
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
