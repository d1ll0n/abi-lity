import { ABITypeKind } from "../../constants";
import { AddressType } from "./address_type";

/**
 * Represents a Solidity contract type reference (e.g., `IERC20`, `MyContract`).
 *
 * Contract types are encoded identically to `address` in ABI calldata (160 bits,
 * right-aligned). The `name` field preserves the contract name for source-level
 * code generation, but encoding-wise this behaves exactly like `AddressType`.
 *
 * Maps to `ContractType` in solc Types.h:1170, where `fullEncodingType()` returns
 * the address type.
 */
export class ContractType extends AddressType {
  readonly kind = ABITypeKind.Address;

  /** Contract name (e.g., `"IERC20"`). */
  name: string;

  exactBits = 160;
  leftAligned = false;
  encodingType = undefined;

  constructor(name: string, payable?: boolean) {
    super(payable);
    this.name = name;
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
