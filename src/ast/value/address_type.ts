import { ABITypeKind } from "../../constants";
import { ValueType } from "./value_type";

export class AddressType extends ValueType {
  readonly kind = ABITypeKind.Address;
  payable: boolean;
  exactBits = 160;
  leftAligned = false;

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
