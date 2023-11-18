import { DataLocation } from "solc-typed-ast";
import { ABITypeKind } from "../constants";
import { sumOrUndefined } from "../utils/array";
import { Node, NodeSelector } from "./node";
import { assert } from "solc-typed-ast";
import { sumBy } from "lodash";

export abstract class TypeNode extends Node<TypeNode> {
  parent?: TypeNodeWithChildren<TypeNode>;

  abstract kind: ABITypeKind;

  /** @returns true if the type is a value type */
  abstract readonly isValueType: boolean;

  get isReferenceType(): boolean {
    return !this.isValueType;
  }

  abstract readonly leftAligned: boolean;

  labelFromParent?: string;

  isIndexed = false;

  abstract copy(): TypeNode;

  pp(): string {
    return this.signatureInExternalFunction(true);
  }

  writeParameter(location: DataLocation, name = this.labelFromParent): string {
    const locationString =
      location === DataLocation.Default || this.isValueType ? "" : location.toString();
    return [this.canonicalName, locationString, name].filter(Boolean).join(" ");
  }

  get exactBitsOffset(): number {
    return this.parent?.exactBitsOffsetOfChild(this) ?? 0;
  }

  get memoryHeadOffset(): number {
    return this.parent?.memoryOffsetOfChild(this) ?? 0;
  }

  get calldataHeadOffset(): number {
    return this.parent?.calldataOffsetOfChild(this) ?? 0;
  }

  get hasEmbeddedDynamicTypes(): boolean {
    return this.maxNestedDynamicTypes > 1;
  }

  get hasEmbeddedReferenceTypes(): boolean {
    return this.maxNestedReferenceTypes > 1;
  }

  get maxNestedDynamicTypes(): number {
    if (!this.isDynamicallyEncoded) return 0;
    return Math.max(...this.children.map((child) => child.maxNestedDynamicTypes), 0) + 1;
  }

  get maxNestedReferenceTypes(): number {
    if (!this.isReferenceType) return 0;
    return Math.max(...this.children.map((child) => child.maxNestedReferenceTypes), 0) + 1;
  }

  get totalNestedDynamicTypes(): number {
    if (!this.isDynamicallyEncoded) return 0;
    let sum = 1;
    for (const child of this.children) {
      sum += child.totalNestedDynamicTypes;
    }
    return sum;
  }

  get totalNestedReferenceTypes(): number {
    if (!this.isReferenceType) return 0;
    let sum = 1;
    for (const child of this.children) {
      sum += child.totalNestedReferenceTypes;
    }
    return sum;
  }

  // ======================================================================//
  //                            Encoding Size                              //
  // ======================================================================//

  /**
   * @returns number of bytes used by this type when encoded for CALL. Cannot be used for
   * dynamically encoded types.
   * Always returns a value greater than zero and throws if the type cannot be encoded in calldata
   * (or is dynamically encoded).
   */
  abstract calldataEncodedSize: number;

  /**
   * @returns the (minimal) size of the calldata tail for this type. Can only be used for
   * dynamically encoded types. For dynamically-sized arrays this is 32 (the size of the length),
   * for statically-sized, but dynamically encoded arrays this is 32*length(), for structs
   * this is the sum of the calldataHeadSize's of its members.
   * Always returns a value greater than zero and throws if the type cannot be encoded in calldata
   * (or is not dynamically encoded).
   */
  abstract calldataEncodedTailSize: number;

  /**
   * @returns the distance between two elements of this type in a calldata array, tuple or struct.
   * For statically encoded types this is the same as calldataEncodedSize.
   * For dynamically encoded types this is the distance between two tail pointers, i.e. 32.
   * Always returns a value greater than zero and throws if the type cannot be encoded in calldata.
   */
  get calldataHeadSize(): number {
    return this.isDynamicallyEncoded ? 32 : this.calldataEncodedSize;
  }

  /** @returns true if the type is a dynamic array */
  abstract isDynamicallySized: boolean;

  /** @returns true if the type is dynamically encoded in the ABI */
  abstract isDynamicallyEncoded: boolean;

  /** @returns bits required to represent the data, irrespective of ABI encoding rules */
  abstract exactBits?: number;

  /** @returns bytes required to represent the data, irrespective of ABI encoding rules */
  get exactBytes(): number | undefined {
    if (this.exactBits === undefined) return undefined;
    return Math.ceil(this.exactBits / 8) * 8;
  }

  /** @returns bits required to represent the data in packed ABI encoding*/
  get packedBits(): number | undefined {
    if (this.exactBits === undefined) return undefined;
    return Math.ceil(this.exactBits / 8) * 8;
  }

  /** @returns bytes required to represent the data in packed ABI encoding*/
  get packedSize(): number | undefined {
    if (this.packedBits === undefined) return undefined;
    return this.packedBits / 8;
  }

  /**
   * @returns the size of this data type in bytes when stored in memory. For memory-reference
   * types, this is the size of the memory pointer.
   */
  get memoryHeadSize(): number {
    return 32;
  }

  get memoryTailSize(): number {
    return 0;
  }

  /**
   * @returns the size of this data type in bytes when stored in memory. For memory-reference
   * types, this is the size of the actual data area, if it is statically-sized.
   */
  get memoryDataSize(): number | undefined {
    return this.calldataEncodedSize;
  }

  /**
   * @returns the complete size of this data type in bytes when stored in memory. For
   * statically-sized memory-reference types, this is the size of the actual data area
   * (heads of components), and the data areas of the components.
   */
  get extendedMemoryDataSize(): number | undefined {
    return this.memoryDataSize;
  }

  get extendedMemoryAllocationSize(): number {
    return 0;
    // const size = this.extendedMemoryDataSize;
    // assert(size !== undefined, `extendedMemoryDataSize undefined`);
    // return size;
  }

  /**
   * @returns the signature of this type in external functions, i.e. `uint256` for integers
   * or `(uint256,bytes8)[2]` for an array of structs. If @structsByName
   * structs are given by canonical name like `ContractName.StructName[2]`.
   */
  abstract signatureInExternalFunction(structsByName: boolean): string;

  signatureInInternalFunction(): string {
    return this.signatureInExternalFunction(true);
  }

  /** @returns the canonical name of this type for use in library function signatures. */
  abstract canonicalName: string;

  get pascalCaseName(): string {
    const identifier = this.identifier.replace(/(_\w)/g, (m) => {
      return m[1].toUpperCase();
    });
    return identifier[0].toUpperCase().concat(identifier.slice(1));
  }

  get identifier(): string {
    return this.canonicalName;
  }

  /**
   *  @returns a (simpler) type that is encoded in the same way for external function calls.
   * This for example returns address for contract types.
   * If there is no such type, returns an empty shared pointer.
   */
  abstract encodingType: TypeNode | undefined;
}

export abstract class TypeNodeWithChildren<T extends TypeNode> extends TypeNode {
  protected ownChildren: T[] = [];

  get children(): readonly T[] {
    return this.ownChildren;
  }

  /** @returns bits required to represent the data, irrespective of ABI encoding rules */
  get exactBits(): number | undefined {
    const lastChild = this.ownChildren[this.ownChildren.length - 1];
    const lastChildOffset = this.exactBitsOffsetOfChild(lastChild);
    if (
      lastChild === undefined ||
      lastChild.exactBits === undefined ||
      lastChildOffset === undefined
    ) {
      return undefined;
    }
    // Use last child's offset + size because some members may be padded
    // to ensure they are readable as one word from memory.
    return lastChildOffset + lastChild.exactBits;
  }

  /** @returns bits required to represent the data, irrespective of ABI encoding rules */
  get packedBits(): number | undefined {
    const childBits = this.children.map((c) => c.packedBits);
    return sumOrUndefined(childBits);
  }

  requireIndexOfChild(node: T): number {
    const index = this.ownChildren.indexOf(node);
    if (index === -1) {
      throw new Error("Reference node is not a child of current node");
    }
    return index;
  }

  /**
   * @returns the size in memory of embedded types' heads.
   */
  get embeddedMemoryHeadSize(): number {
    return this.ownChildren.reduce((sum, child) => sum + child.memoryHeadSize, 0);
  }

  get embeddedCalldataHeadSize(): number {
    return this.ownChildren.reduce((sum, child) => sum + child.calldataHeadSize, 0);
  }

  get extendedMemoryAllocationSize(): number {
    const headSize = this.embeddedMemoryHeadSize;
    const dataSize = sumBy(this.ownChildren, (v) => {
      if (v.isValueType || v.isDynamicallySized) {
        return 0;
      }
      return v.extendedMemoryAllocationSize;
    });
    return headSize + dataSize;
  }

  requireFindChildIndexBySelector(selector: NodeSelector<T>): number {
    const index = this.ownChildren.findIndex(selector);
    if (index === -1) {
      throw new Error("Node matching selector not found");
    }
    return index;
  }

  requireFindChildIndex(indexOrNameOrNode: string | number | T): number {
    if (typeof indexOrNameOrNode === "number") {
      if (indexOrNameOrNode > this.ownChildren.length - 1) {
        throw Error(`Index out of bounds: ${indexOrNameOrNode}`);
      }
      return indexOrNameOrNode;
    }
    if (typeof indexOrNameOrNode === "string") {
      return this.requireFindChildIndexBySelector((c) => c.labelFromParent === indexOrNameOrNode);
    }
    return this.requireIndexOfChild(indexOrNameOrNode);
  }

  spliceChildren(start: number, deleteCount: number, ...nodes: T[]): T[] {
    nodes.forEach((node) => {
      node.parent = this;
      if (this.context) {
        node.context = this.context;
      }
    });
    const removedNodes = this.ownChildren.splice(start, deleteCount, ...nodes);
    removedNodes.forEach((node) => {
      node.parent = undefined;
    });
    return removedNodes;
  }

  removeChild(node: T): T {
    const index = this.requireIndexOfChild(node);
    this.spliceChildren(index, 1);
    return node;
  }

  appendChild(node: T): T {
    this.spliceChildren(this.children.length, 0, node);
    return node;
  }

  insertBefore<N extends T[]>(referenceNode: T, ...nodes: N): N {
    const index = this.requireIndexOfChild(referenceNode);
    this.spliceChildren(index, 0, ...nodes);
    return nodes;
  }

  insertAfter<N extends T[]>(referenceNode: T, ...nodes: N): N {
    const index = this.requireIndexOfChild(referenceNode);
    this.spliceChildren(index + 1, 0, ...nodes);
    return nodes;
  }

  insertAtBeginning(node: T): T {
    this.spliceChildren(0, 0, node);
    return node;
  }

  replaceChild<O extends T, N extends T[]>(oldNode: O, ...newNodes: N): O {
    const index = this.requireIndexOfChild(oldNode);

    this.spliceChildren(index, 1, ...newNodes);

    return oldNode;
  }

  exactBitsOffsetOfChild(indexOrNameOrNode: string | number | T): number | undefined {
    const index = this.requireFindChildIndex(indexOrNameOrNode);
    let offset = 0;
    for (let i = 0; i <= index; i++) {
      const member = this.ownChildren[i];
      const size = member.exactBits;
      if (size === undefined) return undefined;
      // For fields that can be read as a single word, pad the end of the previous
      // field if it ends mid-byte and the additional bits would make it impossible
      // to read the current field in one word.
      if (size <= 256 && size + (offset % 8) > 256) {
        offset += 8 - (offset % 8);
      }
      if (i < index) offset += size;
    }
    return offset;
  }

  calldataOffsetOfChild(indexOrNameOrNode: string | number | T): number {
    const index = this.requireFindChildIndex(indexOrNameOrNode);
    let offset = 0;
    for (let i = 0; i < index; i++) {
      const member = this.ownChildren[i];
      offset += member.calldataHeadSize;
    }
    return offset;
  }

  memoryOffsetOfChild(indexOrNameOrNode: string | number | T): number {
    const index = this.requireFindChildIndex(indexOrNameOrNode);
    if (index > this.ownChildren.length - 1) {
      throw Error(`Index out of bounds: ${index}`);
    }
    let offset = 0;
    for (let i = 0; i < index; i++) {
      const member = this.ownChildren[i];
      offset += member.memoryHeadSize;
    }
    return offset;
  }
}

export type Accessors = {
  getterCoderType?: CoderType;
  setterCoderType?: CoderType;
};

export type CoderType = "checked" | "unchecked" | "exact";
