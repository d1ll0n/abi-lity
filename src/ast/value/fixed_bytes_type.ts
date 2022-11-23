import { ABITypeKind } from "../../constants";
import { ValueType } from "./value_type";

export class FixedBytesType extends ValueType {
  readonly kind = ABITypeKind.FixedBytes;
  size: number;
  leftAligned = false;

  constructor(size: number) {
    super();
    this.size = size;
  }

  copy(): FixedBytesType {
    return new FixedBytesType(this.size);
  }

  get unpaddedSize(): number {
    return this.size;
  }

  get canonicalName(): string {
    if (this.size === 1) return `byte`;
    return `bytes${this.size}`;
  }

  encodingType = undefined;
}
