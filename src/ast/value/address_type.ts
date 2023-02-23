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
}
