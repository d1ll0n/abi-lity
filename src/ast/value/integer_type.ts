import { ABITypeKind } from "../../constants";
import { ValueType } from "./value_type";

/**
 * Represents Solidity integer types: `uint8` through `uint256` and `int8` through `int256`.
 *
 * Integers are right-aligned (padded with leading zero bytes) in ABI encoding.
 * The `exactBits` field stores the declared bit width (8, 16, ..., 256), which determines
 * the value range but not the calldata size (always 32 bytes).
 *
 * Maps to `IntegerType` in solc Types.h:483.
 */
export class IntegerType extends ValueType {
  /** Bit width of the integer (8, 16, 24, ..., 256). */
  exactBits: number;

  constructor(exactBits: number, signed: boolean) {
    super();
    this.exactBits = exactBits;
    this.signed = signed;
  }

  copy(): IntegerType {
    return new IntegerType(this.exactBits, this.signed);
  }

  /** Whether this is a signed integer (`int`) vs unsigned (`uint`). */
  signed: boolean;

  /** Integers are right-aligned — padded with leading zero (or sign-extended) bytes. */
  leftAligned = false;

  /** Integers encode as themselves — no type conversion needed. */
  encodingType = undefined;

  get kind(): ABITypeKind.Integer {
    return ABITypeKind.Integer;
  }

  /** Maximum value (inclusive) representable by this integer type. */
  max(): bigint {
    return 2n ** BigInt(this.signed ? this.exactBits - 1 : this.exactBits) - 1n;
  }

  /** Minimum value (inclusive) representable by this integer type. */
  min(): bigint {
    return this.signed ? -(2n ** BigInt(this.exactBits - 1)) : 0n;
  }

  /** Returns `true` if `literal` fits within this integer type's range. */
  fits(literal: bigint): boolean {
    return literal <= this.max() && literal >= this.min();
  }

  /**
   * ABI canonical name, e.g. `"uint256"` or `"int8"`.
   * Uses `packedBits` (rounded up to byte boundary) per ABI spec.
   */
  get canonicalName(): string {
    return `${this.signed ? "" : "u"}int${this.packedBits}`;
  }
}
