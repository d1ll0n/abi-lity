import { ABITypeKind } from "../../constants";
import { ReferenceType } from "./reference_type";

class PackedArrayType extends ReferenceType {
  constructor(isBytes: boolean) {
    super();
    this.isBytes = isBytes;
  }

  isBytes: boolean;

  isDynamicallySized = true;
  isDynamicallyEncoded = true;

  encodingType = undefined;
  unpaddedSize = undefined;

  copy(): PackedArrayType {
    return new PackedArrayType(this.isBytes);
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

export class BytesType extends PackedArrayType {
  constructor() {
    super(true);
  }
}

export class StringType extends PackedArrayType {
  constructor() {
    super(false);
  }
}
