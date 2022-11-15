import { ABITypeKind } from "../../constants";
import { ValueType } from "./value_type";

export class IntegerType extends ValueType {
  constructor(nBits: number, signed: boolean) {
    super();
    this.nBits = nBits;
    this.signed = signed;
  }

  copy(): IntegerType {
    return new IntegerType(this.nBits, this.signed);
  }

  nBits: number;
  signed: boolean;
  leftAligned = false;
  encodingType = undefined;

  get kind(): ABITypeKind {
    if (this.signed) return ABITypeKind.Int;
    return ABITypeKind.Uint;
  }

  get unpaddedSize(): number {
    return this.nBits / 8;
  }

  /// Maximum value (inclusive) representable by this int type.
  max(): bigint {
    return 2n ** BigInt(this.signed ? this.nBits - 1 : this.nBits) - 1n;
  }

  /// Minimum value (inclusive) representable by this int type.
  min(): bigint {
    return this.signed ? -(2n ** BigInt(this.nBits - 1)) : 0n;
  }

  fits(literal: bigint): boolean {
    return literal <= this.max() && literal >= this.min();
  }

  get canonicalName(): string {
    return `${this.signed ? "" : "u"}int${this.nBits}`;
  }
}
