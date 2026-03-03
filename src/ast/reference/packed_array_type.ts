import { ABITypeKind } from "../../constants";
import { ReferenceType } from "./reference_type";

/**
 * Represents the Solidity `bytes` type — a dynamically-sized byte array.
 *
 * In ABI encoding, `bytes` is always dynamically encoded: the head section contains a
 * 32-byte offset pointer, and the tail contains a 32-byte length followed by the packed
 * byte data (padded to 32-byte boundary).
 *
 * Also serves as the base class for `StringType`, which encodes identically.
 *
 * In solc's ABIFunctions.cpp, bytes/string encoding dispatches to `MemoryByteArray`
 * (for memory location) or `CalldataArrayWithoutCleanup` (for calldata).
 *
 * Maps to `ArrayType` with `isByteArrayOrString() == true` in solc Types.h:835.
 */
export class BytesType extends ReferenceType {
  constructor() {
    super();
    this.isBytes = true;
  }

  /** `true` for `bytes`, `false` for `string` (set by StringType subclass). */
  isBytes: boolean;

  /** Always `true` — byte arrays have runtime-determined length. */
  isDynamicallySized = true;

  /** Always `true` — requires head offset + tail data in ABI encoding. */
  isDynamicallyEncoded = true;

  encodingType = undefined;

  /** `undefined` — dynamic types have no compile-time-known bit size. */
  exactBits = undefined;

  copy(): BytesType {
    return new BytesType();
  }

  get kind(): ABITypeKind.Bytes {
    return ABITypeKind.Bytes;
  }

  /**
   * @throws Always — dynamic types have no fixed calldata encoded size.
   */
  get calldataEncodedSize(): number {
    throw Error(`Can not read calldata size of dynamically encoded ${this.canonicalName}`);
  }

  /** 32 bytes — the length prefix in the tail section. */
  get calldataEncodedTailSize(): number {
    return 32;
  }

  get memoryDataSize(): number | undefined {
    return undefined;
  }

  get extendedMemoryDataSize(): number | undefined {
    return undefined;
  }

  get canonicalName(): string {
    return this.isBytes ? "bytes" : "string";
  }

  signatureInExternalFunction(): string {
    return this.canonicalName;
  }
}

/**
 * Represents the Solidity `string` type.
 *
 * Strings are encoded identically to `bytes` in ABI — the distinction only matters
 * at the Solidity type level. Extends `BytesType` with `isBytes = false`.
 */
export class StringType extends BytesType {
  constructor() {
    super();
    this.isBytes = false;
  }

  copy(): StringType {
    return new StringType();
  }
}
