import { ABITypeKind } from "../../constants";
import { ValueType } from "./value_type";

export class BoolType extends ValueType {
  readonly kind = ABITypeKind.Bool;
  exactBits = 1;
  leftAligned = false;
  encodingType = undefined;
  canonicalName = "bool";

  copy(): BoolType {
    return new BoolType();
  }
}
