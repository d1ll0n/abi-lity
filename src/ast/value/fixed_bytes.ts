import { ABITypeKind } from "../../constants";
import { ValueType } from "./value_type";

export class FixedBytesType extends ValueType {
  readonly kind = ABITypeKind.Bytes;
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
    return `bytes${this.size}`;
  }

  encodingType = undefined;
}
