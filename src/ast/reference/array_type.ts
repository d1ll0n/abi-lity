import { ABITypeKind } from "../../constants";
import { TypeNode } from "../type_node";
import { ReferenceType } from "./reference_type";

export class ArrayType extends ReferenceType {
  encodingType = undefined;
  readonly kind = ABITypeKind.Array;
  baseType: TypeNode;
  length: number | undefined;

  unpaddedSize = undefined;

  constructor(baseType: TypeNode, length: number | undefined) {
    super();
    this.baseType = baseType;
    this.length = length;
  }

  copy(): ArrayType {
    return new ArrayType(this.baseType.copy(), this.length);
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
    return this.baseType.memoryHeadSize * this.length;
  }

  get extendedMemoryDataSize(): number | undefined {
    if (this.length === undefined || this.baseType.extendedMemoryDataSize === undefined)
      return undefined;
    return this.baseType.extendedMemoryDataSize * this.length;
  }

  signatureInExternalFunction(_structsByName: boolean): string {
    if (this.isDynamicallySized) {
      const x = this.length;
      x;
    }
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
}
