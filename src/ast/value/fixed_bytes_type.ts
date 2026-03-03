import { ABITypeKind } from "../../constants";
import { ValueType } from "./value_type";

/**
 * Represents the Solidity `bytes1` through `bytes32` fixed-size byte types.
 *
 * Unlike all other value types, `bytesN` values are **left-aligned** in solc's encoding —
 * the data occupies the high-order bytes and trailing bytes are zero-padded. In solc's
 * C++ type system, `FixedBytesType::leftAligned()` returns `true` (Types.h:686).
 *
 * Note: abi-lity currently sets `leftAligned = false` on this type; the left-alignment
 * distinction is handled in codegen rather than in the type metadata.
 *
 * Maps to `FixedBytesType` in solc Types.h:686.
 */
export class FixedBytesType extends ValueType {
  readonly kind = ABITypeKind.FixedBytes;

  /** Byte count (1–32). */
  size: number;

  /**
   * Set to `false` in abi-lity's model. Note: in solc, FixedBytesType IS left-aligned.
   * @see docs/type-system.md for details on the alignment handling.
   */
  leftAligned = false;

  constructor(size: number) {
    super();
    this.size = size;
  }

  copy(): FixedBytesType {
    return new FixedBytesType(this.size);
  }

  /** Exact bit count: `size * 8`. */
  get exactBits(): number {
    return this.size * 8;
  }

  /** Returns `"byte"` for size 1, otherwise `"bytes2"` ... `"bytes32"`. */
  get canonicalName(): string {
    if (this.size === 1) return `byte`;
    return `bytes${this.size}`;
  }

  min(): bigint {
    return 0n;
  }

  max(): bigint {
    return 2n ** BigInt(this.exactBits) - 1n;
  }

  encodingType = undefined;
}
