import { ABITypeKind } from "../../constants";
import { ValueType } from "./value_type";

/**
 * Represents the Solidity `address` / `address payable` type.
 *
 * Addresses are 160 bits (20 bytes), right-aligned in a 32-byte ABI word
 * (12 zero-padded leading bytes followed by 20 address bytes).
 *
 * Maps to `AddressType` in solc Types.h:443.
 */
export class AddressType extends ValueType {
  readonly kind = ABITypeKind.Address;

  /** Whether this is `address payable` (can receive Ether via `.transfer()`/`.send()`). */
  payable: boolean;

  /** Addresses are 160 bits (20 bytes). */
  exactBits = 160;

  /** Addresses are right-aligned — 12 leading zero bytes, then 20 address bytes. */
  leftAligned = false;

  /** Addresses encode as themselves — no type conversion needed. */
  encodingType = undefined;

  constructor(payable = false) {
    super();
    this.payable = payable;
  }

  signatureInExternalFunction(): string {
    return this.canonicalName;
  }

  get canonicalName(): string {
    return `address${this.payable ? " payable" : ""}`;
  }

  copy(): AddressType {
    return new AddressType();
  }

  min(): bigint {
    return 0n;
  }

  max(): bigint {
    return 2n ** 160n - 1n;
  }
}
