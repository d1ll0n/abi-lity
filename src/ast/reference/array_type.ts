import { DataLocation } from "solc-typed-ast";
import { ABITypeKind } from "../../constants";
import { TypeNode, TypeNodeWithChildren } from "../type_node";

export class ArrayType extends TypeNodeWithChildren<TypeNode> {
  encodingType = undefined;
  readonly kind = ABITypeKind.Array;
  baseType: TypeNode;
  length: number | undefined;

  unpaddedSize = undefined;
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

  get isDynamicallyEncoded(): boolean {
    return this.isDynamicallySized || this.baseType.isDynamicallyEncoded;
  }

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

  get calldataEncodedSize(): number {
    if (this.length === undefined) {
      throw Error(`Can not read calldata size of dynamically sized array`);
    }
    return this.length * this.calldataStride;
  }

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

  get children(): TypeNode[] {
    return this.pickNodes(this.baseType);
  }

  calldataOffsetOfChild(indexOrNameOrNode: number): number {
    return this.baseType.calldataHeadSize * indexOrNameOrNode;
  }

  memoryOffsetOfChild(indexOrNameOrNode: number): number {
    return this.baseType.memoryHeadSize * indexOrNameOrNode;
  }

  isValueType = false;
}
