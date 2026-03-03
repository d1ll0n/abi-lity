import { TypeNode } from "../type_node";

/**
 * Abstract base class for all Solidity value types (bool, uint, address, bytesN, enum, etc.).
 *
 * Value types have a fixed, statically-known size and are always encoded inline in ABI
 * calldata — they never use the head/tail indirection pattern. In calldata, every value
 * type occupies exactly 32 bytes (one EVM word), right-padded with zeros. The exception
 * is `FixedBytesType` (bytes1–bytes32), which is left-padded.
 *
 * Corresponds to types where `Type::isValueType()` returns `true` in solc's
 * Types.h:304.
 */
export abstract class ValueType extends TypeNode {
  /** Always `true` — value types are never reference types. */
  isValueType = true;

  /**
   * Always 32 — value types are padded to one 256-bit word in ABI calldata encoding,
   * regardless of their actual bit width.
   *
   * @see `Type::calldataEncodedSize(true)` in solc Types.h:249
   */
  calldataEncodedSize = 32;

  /** Always `false` — value types are always encoded inline (no tail pointer). */
  isDynamicallyEncoded = false;

  /** Always `false` — value types have a compile-time-known size. */
  isDynamicallySized = false;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  signatureInExternalFunction(structsByName: boolean): string {
    return this.canonicalName;
  }

  /**
   * Value types have no tail section — always throws.
   * @throws Always, since value types are never dynamically encoded.
   */
  get calldataEncodedTailSize(): number {
    throw Error(`Value types do not have calldata tail`);
  }

  /** Always 0 — value types don't allocate additional memory beyond the head slot. */
  get extendedMemoryAllocationSize(): number {
    return 0;
  }

  /** Maximum representable value, or `undefined` if not applicable. */
  max(): bigint | undefined {
    return undefined;
  }

  /** Minimum representable value, or `undefined` if not applicable. */
  min(): bigint | undefined {
    return undefined;
  }
}
