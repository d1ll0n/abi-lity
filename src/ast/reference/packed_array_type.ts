import { ABITypeKind } from "../../constants";
import { ReferenceType } from "./reference_type";

export class BytesType extends ReferenceType {
  constructor() {
    super();
    this.isBytes = true;
  }

  isBytes: boolean;

  isDynamicallySized = true;
  isDynamicallyEncoded = true;

  encodingType = undefined;
  exactBits = undefined;

  copy(): BytesType {
    return new BytesType();
  }

  get calldataEncodedSize(): number {
    throw Error(`Can not read calldata size of dynamically encoded ${this.canonicalName}`);
  }

  get calldataEncodedTailSize(): number {
    return 32;
  }

  get memoryDataSize(): number | undefined {
    return undefined;
  }

  get extendedMemoryDataSize(): number | undefined {
    return undefined;
  }

  get kind(): ABITypeKind {
    return this.isBytes ? ABITypeKind.Bytes : ABITypeKind.String;
  }

  get canonicalName(): string {
    return this.isBytes ? "bytes" : "string";
  }

  signatureInExternalFunction(): string {
    return this.canonicalName;
  }
}

export class StringType extends BytesType {
  constructor() {
    super();
    this.isBytes = false;
  }

  copy(): StringType {
    return new StringType();
  }
}
