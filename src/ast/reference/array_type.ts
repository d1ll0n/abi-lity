import { ABITypeKind } from "../../constants";
import { TypeNode, TypeNodeWithChildren } from "../type_node";

/**
 * Represents Solidity array types — both fixed-size (`T[N]`) and dynamic (`T[]`).
 *
 * Arrays are one of the most complex types for ABI encoding because their encoding
 * strategy depends on three factors:
 * 1. Whether the array itself is dynamically sized (`length === undefined`)
 * 2. Whether the base type is dynamically encoded
 * 3. The data location (calldata, memory, storage) — affects access patterns in codegen
 *
 * In solc's ABIFunctions.cpp, arrays dispatch to different encoding functions based on
 * these factors: `SimpleArray` (generic), `CompactStorageArray` (packed storage),
 * `CalldataArrayWithoutCleanup` (optimized calldata copy), `MemoryByteArray` (bytes/string).
 *
 * Maps to `ArrayType` in solc Types.h:835.
 */
export class ArrayType extends TypeNodeWithChildren<TypeNode> {
  encodingType = undefined;
  readonly kind = ABITypeKind.Array;

  /** The element type (e.g., `IntegerType(256, false)` for `uint256[]`). */
  baseType: TypeNode;

  /** Fixed length for `T[N]`, or `undefined` for dynamic arrays `T[]`. */
  length: number | undefined;

  get exactBits(): number | undefined {
    if (this.isDynamicallyEncoded) return undefined;
    return (this.baseType.exactBits as number) * (this.length as number);
  }

  leftAligned = false;

  constructor(baseType: TypeNode, length: number | undefined) {
    super();
    this.baseType = baseType;
    this.length = length;
  }

  copy(): ArrayType {
    const arr = new ArrayType(this.baseType.copy(), this.length);
    arr.labelFromParent = this.labelFromParent;
    return arr;
  }

  /**
   * An array is dynamically encoded if:
   * - It is dynamically sized (T[]), OR
   * - Its base type is dynamically encoded (e.g., T[][3] where T[] is dynamic)
   *
   * This mirrors the logic in solc's `ArrayType::isDynamicallyEncoded()`.
   */
  get isDynamicallyEncoded(): boolean {
    return this.isDynamicallySized || this.baseType.isDynamicallyEncoded;
  }

  /** `true` for dynamic arrays (`T[]`) where `length` is `undefined`. */
  get isDynamicallySized(): boolean {
    return this.length === undefined;
  }

  get canonicalName(): string {
    return this.baseType.canonicalName + "[" + (this.isDynamicallySized ? "" : this.length) + "]";
  }

  /**
   * @returns The offset to advance in calldata to move from one array element to the next.
   */
  get calldataStride(): number {
    return this.baseType.calldataHeadSize;
  }

  /**
   * @returns The offset to advance in calldata to move from one array element to the next.
   */
  get memoryStride(): number {
    return this.baseType.memoryHeadSize;
  }

  /**
   * Total byte size of the array in ABI calldata (for fixed-size arrays only).
   * @throws For dynamically sized arrays — their size is not known at compile time.
   */
  get calldataEncodedSize(): number {
    if (this.length === undefined) {
      throw Error(`Can not read calldata size of dynamically sized array`);
    }
    return this.length * this.calldataStride;
  }

  /**
   * Minimum tail section size for dynamically encoded arrays.
   * - Dynamic-sized (`T[]`): 32 bytes (just the length prefix)
   * - Fixed-size with dynamic base (`T[][N]`): the full encoded size of N elements
   * @throws For statically encoded arrays (no tail section).
   */
  get calldataEncodedTailSize(): number {
    if (!this.isDynamicallyEncoded) {
      throw Error(`Can not read calldata tail of statically encoded array`);
    }
    if (this.isDynamicallySized) return 32;
    return this.calldataEncodedSize;
  }

  get memoryDataSize(): number | undefined {
    if (this.length === undefined) return undefined;
    return (this.baseType.memoryDataSize as number) * this.length;
  }

  get extendedMemoryDataSize(): number | undefined {
    if (this.length === undefined || this.baseType.extendedMemoryDataSize === undefined)
      return undefined;
    return this.baseType.extendedMemoryDataSize * this.length;
  }

  get extendedMemoryAllocationSize(): number {
    if (this.length === undefined) return 0;
    const headSize = this.embeddedMemoryHeadSize;
    const dataSize = this.baseType.extendedMemoryAllocationSize * this.length;
    return headSize + dataSize;
  }

  get embeddedMemoryHeadSize(): number {
    if (this.isDynamicallySized) {
      throw Error("Can not determine embedded head size for dynamically sized array");
    }
    return (this.length as number) * 32;
  }

  get embeddedCalldataHeadSize(): number {
    if (this.isDynamicallySized) {
      throw Error("Can not determine embedded head size for dynamically sized array");
    }
    return (this.length as number) * this.baseType.calldataHeadSize;
  }

  get identifier(): string {
    const prefix = this.isDynamicallySized ? `dyn_array` : `array_${this.length}`;
    return `${prefix}_${this.baseType.identifier}`;
  }

  signatureInExternalFunction(_structsByName: boolean): string {
    return (
      this.baseType.signatureInExternalFunction(_structsByName) +
      "[" +
      (this.isDynamicallySized ? "" : this.length) +
      "]"
    );
  }

  signatureInInternalFunction(): string {
    return (
      this.baseType.signatureInInternalFunction() +
      "[" +
      (this.isDynamicallySized ? "" : this.length) +
      "]"
    );
  }

  get children(): TypeNode[] {
    return this.pickNodes(this.baseType);
  }

  /**
   * Bit offset of the Nth element in packed/storage layout.
   * Simple multiplication — no word-boundary padding for arrays (unlike structs).
   */
  exactBitsOffsetOfChild(indexOrNameOrNode: number): number | undefined {
    if (this.baseType.exactBits === undefined) return undefined;
    return indexOrNameOrNode * this.baseType.exactBits;
  }

  /** Byte offset of the Nth element's head in ABI calldata. */
  calldataOffsetOfChild(indexOrNameOrNode: number): number {
    return this.baseType.calldataHeadSize * indexOrNameOrNode;
  }

  /** Byte offset of the Nth element's head in memory. */
  memoryOffsetOfChild(indexOrNameOrNode: number): number {
    return this.baseType.memoryHeadSize * indexOrNameOrNode;
  }

  isValueType = false;
}
