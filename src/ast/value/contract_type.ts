import { ABITypeKind } from "../../constants";
import { AddressType } from "./address_type";

export class ContractType extends AddressType {
  readonly kind = ABITypeKind.Address;
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
