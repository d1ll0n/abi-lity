import { ABITypeKind } from "../../constants";
import { ValueType } from "./value_type";

/**
 * Represents the Solidity `bool` type.
 *
 * A boolean is 1 bit, right-aligned in a 32-byte ABI word (0x00...00 or 0x00...01).
 *
 * Maps to `BoolType` in solc Types.h:720.
 */
export class BoolType extends ValueType {
  readonly kind = ABITypeKind.Bool;
  exactBits = 1;
  leftAligned = false;
  encodingType = undefined;
  canonicalName = "bool";

  copy(): BoolType {
    return new BoolType();
  }

  min(): bigint {
    return 0n;
  }

  max(): bigint {
    return 1n;
  }
}
