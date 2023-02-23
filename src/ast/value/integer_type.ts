import { ABITypeKind } from "../../constants";
import { ValueType } from "./value_type";

export class IntegerType extends ValueType {
  exactBits: number;

  constructor(exactBits: number, signed: boolean) {
    super();
    this.exactBits = exactBits;
    this.signed = signed;
  }

  copy(): IntegerType {
    return new IntegerType(this.exactBits, this.signed);
  }

  signed: boolean;
  leftAligned = false;
  encodingType = undefined;

  get kind(): ABITypeKind {
    if (this.signed) return ABITypeKind.Int;
    return ABITypeKind.Uint;
  }

  /// Maximum value (inclusive) representable by this int type.
  max(): bigint {
    return 2n ** BigInt(this.signed ? this.exactBits - 1 : this.exactBits) - 1n;
  }

  /// Minimum value (inclusive) representable by this int type.
  min(): bigint {
    return this.signed ? -(2n ** BigInt(this.exactBits - 1)) : 0n;
  }

  fits(literal: bigint): boolean {
    return literal <= this.max() && literal >= this.min();
  }

  get canonicalName(): string {
    return `${this.signed ? "" : "u"}int${this.packedBits}`;
  }
}
