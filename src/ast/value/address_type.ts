import { ABITypeKind } from "../../constants";
import { ValueType } from "./value_type";

export class AddressType extends ValueType {
  readonly kind = ABITypeKind.Address;
  exactBits = 160;
  leftAligned = false;
  canonicalName = "address";

  encodingType = undefined;

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
