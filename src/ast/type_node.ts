import { ABITypeKind } from "../constants";
import { Node } from "./node";

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

  abstract copy(): TypeNode;

  pp(): string {
    return this.signatureInExternalFunction(true);
  }

  get maxDynamicDepthOfChildren(): number {
    return Math.max(
      ...this.children.map((child) => {
        if (child.isDynamicallyEncoded) return 1 + child.maxDynamicDepthOfChildren;
        return 0;
      })
    );
  }

  get maxReferenceDepthOfChildren(): number {
    return Math.max(
      ...this.children.map((child) => {
        if (child.isReferenceType) return 1 + child.maxReferenceDepthOfChildren;
        return 0;
      })
    );
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

  /** @returns bytes required for the data, irrespective of ABI encoding rules */
  abstract unpaddedSize?: number;

  /**
   * @returns the size of this data type in bytes when stored in memory. For memory-reference
   * types, this is the size of the memory pointer.
   */
  get memoryHeadSize(): number {
    return 32;
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

  /**
   * @returns the signature of this type in external functions, i.e. `uint256` for integers
   * or `(uint256,bytes8)[2]` for an array of structs. If @structsByName
   * structs are given by canonical name like `ContractName.StructName[2]`.
   */
  abstract signatureInExternalFunction(structsByName: boolean): string;

  /** @returns the canonical name of this type for use in library function signatures. */
  abstract canonicalName: string;

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

  requireFindChildIndex(node: T): number {
    const index = this.ownChildren.indexOf(node);

    if (index === -1) {
      throw new Error("Reference node is not a child of current node");
    }
    return index;
  }

  spliceChildren(start: number, deleteCount: number, ...nodes: T[]): T[] {
    nodes.forEach((node) => {
      node.parent = this;
    });
    const removedNodes = this.ownChildren.splice(start, deleteCount, ...nodes);
    removedNodes.forEach((node) => {
      node.parent = undefined;
    });
    return removedNodes;
  }

  removeChild(node: T): T {
    const index = this.requireFindChildIndex(node);
    this.spliceChildren(index, 1);
    return node;
  }

  appendChild(node: T): T {
    this.spliceChildren(this.children.length, 0, node);
    return node;
  }

  insertBefore<N extends T[]>(referenceNode: T, ...nodes: N): N {
    const index = this.requireFindChildIndex(referenceNode);
    this.spliceChildren(index, 0, ...nodes);
    return nodes;
  }

  insertAfter<N extends T[]>(referenceNode: T, ...nodes: N): N {
    const index = this.requireFindChildIndex(referenceNode);
    this.spliceChildren(index + 1, 0, ...nodes);
    return nodes;
  }

  insertAtBeginning(node: T): T {
    this.spliceChildren(0, 0, node);
    return node;
  }

  replaceChild<O extends T, N extends T[]>(oldNode: O, ...newNodes: N): O {
    const index = this.requireFindChildIndex(oldNode);

    this.spliceChildren(index, 1, ...newNodes);

    return oldNode;
  }
}
