import { DataLocation } from "solc-typed-ast";
import { ABITypeKind } from "../constants";
import { sumOrUndefined } from "../utils/array";
import { Node, NodeSelector } from "./node";
import { assert } from "solc-typed-ast";
import { sumBy } from "lodash";

/**
 * Abstract base class for all ABI type representations in abi-lity.
 *
 * Every Solidity type that participates in ABI encoding extends TypeNode. The class carries
 * all the encoding metadata (sizes, alignment, dynamic flags) that solc's `Type` base class
 * exposes as virtual methods in `libsolidity/ast/Types.h`. Where solc computes these at
 * Yul codegen time, abi-lity precomputes them as properties on the type tree.
 *
 * TypeNodes form a tree: a struct's TypeNode has its members as children, a tuple has its
 * parameters, and an array has its base type. This structure enables offset calculations
 * by walking up from a leaf to the root.
 *
 * @see docs/type-system.md for the full hierarchy and encoding semantics.
 */
export abstract class TypeNode extends Node<TypeNode> {
  parent?: TypeNodeWithChildren<TypeNode>;

  /** Discriminant for the concrete type kind — see `ABITypeKind` enum. */
  abstract kind: ABITypeKind;

  /**
   * `true` for value types (bool, int, address, bytesN, enum, etc.).
   * Value types always occupy exactly 32 bytes in ABI calldata and are never dynamically encoded.
   *
   * @see `Type::isValueType()` in solc Types.h:304
   */
  abstract readonly isValueType: boolean;

  /** Inverse of `isValueType` — `true` for arrays, structs, tuples, bytes, string. */
  get isReferenceType(): boolean {
    return !this.isValueType;
  }

  /**
   * Whether the type's data is left-aligned in a 32-byte ABI word.
   *
   * In solc, only `FixedBytesType` (bytes1–bytes32) returns `true` — all other types
   * are right-aligned (data in the low-order bytes, padded with leading zeros).
   *
   * @see `Type::leftAligned()` in solc Types.h:293
   */
  abstract readonly leftAligned: boolean;

  /**
   * Name assigned to this node by its parent (e.g., struct member name, parameter name).
   * `undefined` for unnamed types like array base types.
   */
  labelFromParent?: string;

  /** Whether this parameter is indexed (only meaningful for event parameters). */
  isIndexed = false;

  /** Creates a deep copy of this type node (and its children). */
  abstract copy(): TypeNode;

  /** Pretty-prints the type for debugging (uses external function signature format). */
  pp(): string {
    return this.signatureInExternalFunction(true);
  }

  /**
   * Generates a Solidity parameter declaration string like `"uint256 memory value"`.
   * @param location Data location qualifier (memory, calldata, etc.)
   * @param name Parameter name (defaults to `labelFromParent`)
   */
  writeParameter(location: DataLocation, name = this.labelFromParent): string {
    const locationString =
      location === DataLocation.Default || this.isValueType ? "" : location.toString();
    return [this.canonicalName, locationString, name].filter(Boolean).join(" ");
  }

  /**
   * Bit offset of this node within its parent in packed/storage layout.
   * Delegates to parent's `exactBitsOffsetOfChild()`. Returns 0 for root nodes.
   */
  get exactBitsOffset(): number {
    return this.parent?.exactBitsOffsetOfChild(this) ?? 0;
  }

  /**
   * Byte offset of this node's head slot within its parent in memory layout.
   * Each member occupies a 32-byte head slot in memory.
   */
  get memoryHeadOffset(): number {
    return this.parent?.memoryOffsetOfChild(this) ?? 0;
  }

  /**
   * Byte offset of this node's head slot within its parent in ABI calldata.
   * Static types: this is the data offset. Dynamic types: this is the offset-pointer offset.
   */
  get calldataHeadOffset(): number {
    return this.parent?.calldataOffsetOfChild(this) ?? 0;
  }

  /** `true` if this type contains dynamic types nested more than one level deep. */
  get hasEmbeddedDynamicTypes(): boolean {
    return this.maxNestedDynamicTypes > 1;
  }

  /** `true` if this type contains reference types nested more than one level deep. */
  get hasEmbeddedReferenceTypes(): boolean {
    return this.maxNestedReferenceTypes > 1;
  }

  /** Maximum nesting depth of dynamically-encoded types in this subtree. */
  get maxNestedDynamicTypes(): number {
    if (!this.isDynamicallyEncoded) return 0;
    return Math.max(...this.children.map((child) => child.maxNestedDynamicTypes), 0) + 1;
  }

  /** Maximum nesting depth of reference types in this subtree. */
  get maxNestedReferenceTypes(): number {
    if (!this.isReferenceType) return 0;
    return Math.max(...this.children.map((child) => child.maxNestedReferenceTypes), 0) + 1;
  }

  /** Total count of dynamically-encoded type nodes in this subtree (including self). */
  get totalNestedDynamicTypes(): number {
    if (!this.isDynamicallyEncoded) return 0;
    let sum = 1;
    for (const child of this.children) {
      sum += child.totalNestedDynamicTypes;
    }
    return sum;
  }

  /** Total count of reference type nodes in this subtree (including self). */
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
    return Math.ceil(this.exactBits / 8);
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

  /** Size of this type's memory tail. Always 0 for the base TypeNode. */
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

  /**
   * Total memory bytes to allocate for this type and all its static sub-components.
   * Returns 0 for the base TypeNode (overridden by composite types).
   */
  get extendedMemoryAllocationSize(): number {
    return 0;
  }

  /**
   * @returns the signature of this type in external functions, i.e. `uint256` for integers
   * or `(uint256,bytes8)[2]` for an array of structs. If @structsByName
   * structs are given by canonical name like `ContractName.StructName[2]`.
   */
  abstract signatureInExternalFunction(structsByName: boolean): string;

  /**
   * Type signature for internal function parameters.
   * Defaults to the external signature; overridden by types that differ internally
   * (e.g., `FunctionType` includes visibility and return types).
   */
  signatureInInternalFunction(): string {
    return this.signatureInExternalFunction(true);
  }

  /**
   * The canonical name of this type for use in library function signatures and ABI.
   * E.g., `"uint256"`, `"address"`, `"(uint256,bytes32)"` for a tuple.
   */
  abstract canonicalName: string;

  /** PascalCase version of the identifier, used for generated code naming. */
  get pascalCaseName(): string {
    const identifier = this.identifier.replace(/(_\w)/g, (m) => {
      return m[1].toUpperCase();
    });
    return identifier[0].toUpperCase().concat(identifier.slice(1));
  }

  /** Unique identifier for code generation naming. Defaults to `canonicalName`. */
  get identifier(): string {
    return this.canonicalName;
  }

  /**
   * A simpler type that encodes identically for external function calls.
   * For example, contract types return `AddressType`, enums return `IntegerType(8)`.
   * Returns `undefined` if the type already encodes as itself.
   *
   * @see `Type::fullEncodingType()` in solc Types.h
   */
  abstract encodingType: TypeNode | undefined;
}

/**
 * Abstract TypeNode that manages an ordered list of child type nodes.
 *
 * This is the base class for composite types that contain other types as members:
 * `TupleLikeType` (structs, tuples) and `ArrayType`. It provides:
 * - Child management (append, insert, remove, replace, splice)
 * - Offset calculations (calldata, memory, packed/storage bit offsets)
 * - Aggregate size computations from children
 *
 * The three offset methods (`calldataOffsetOfChild`, `memoryOffsetOfChild`,
 * `exactBitsOffsetOfChild`) each compute positions according to different layout rules:
 * - Calldata: head sizes vary per type (32 for dynamic, actual size for static)
 * - Memory: always 32-byte slots (pointers or padded values)
 * - Packed/storage: exact bit widths with word-boundary padding
 */
export abstract class TypeNodeWithChildren<T extends TypeNode> extends TypeNode {
  protected ownChildren: T[] = [];

  get children(): readonly T[] {
    return this.ownChildren;
  }

  /**
   * Total bits for packed/storage layout, computed from the last child's offset + size.
   * Accounts for word-boundary padding inserted by `exactBitsOffsetOfChild()`.
   * Returns `undefined` if any child has unknown size (dynamic types).
   */
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

  /**
   * Sum of all children's `packedBits` (byte-aligned bit widths).
   * Returns `undefined` if any child has unknown packed size.
   */
  get packedBits(): number | undefined {
    const childBits = this.children.map((c) => c.packedBits);
    return sumOrUndefined(childBits);
  }

  /** Returns the index of `node` in `ownChildren`, or throws if not found. */
  requireIndexOfChild(node: T): number {
    const index = this.ownChildren.indexOf(node);
    if (index === -1) {
      throw new Error("Reference node is not a child of current node");
    }
    return index;
  }

  /** Sum of all children's `memoryHeadSize` (typically `children.length * 32`). */
  get embeddedMemoryHeadSize(): number {
    return this.ownChildren.reduce((sum, child) => sum + child.memoryHeadSize, 0);
  }

  /** Sum of all children's `calldataHeadSize` — the total head section size in ABI calldata. */
  get embeddedCalldataHeadSize(): number {
    return this.ownChildren.reduce((sum, child) => sum + child.calldataHeadSize, 0);
  }

  /**
   * Total memory to allocate for this composite type and its statically-sized sub-components.
   * Includes the head section (one 32-byte slot per child) plus the data areas of any
   * statically-sized reference type children. Dynamically-sized children are excluded
   * (their memory is allocated separately at runtime).
   */
  get extendedMemoryAllocationSize(): number {
    const headSize = this.embeddedMemoryHeadSize;
    const dataSize = sumBy(this.ownChildren, (v) => {
      // Value types are inline in the head slot, dynamically-sized types are
      // allocated separately — only include fixed-size reference type children.
      if (v.isValueType || v.isDynamicallySized) {
        return 0;
      }
      return v.extendedMemoryAllocationSize;
    });
    return headSize + dataSize;
  }

  /** Finds a child by selector predicate, or throws if not found. */
  requireFindChildIndexBySelector(selector: NodeSelector<T>): number {
    const index = this.ownChildren.findIndex(selector);
    if (index === -1) {
      throw new Error("Node matching selector not found");
    }
    return index;
  }

  /**
   * Resolves a child reference to an index. Accepts:
   * - `number`: validates bounds and returns it
   * - `string`: finds child by `labelFromParent`
   * - `T`: finds child by reference equality
   */
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

  /**
   * Low-level child manipulation. Inserts `nodes` at `start`, removing `deleteCount` existing
   * children. Sets `parent` and `context` on inserted nodes, clears `parent` on removed ones.
   */
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

  /**
   * Computes the bit offset of a child in packed/storage layout.
   *
   * This is the most complex offset calculation because it handles a word-boundary
   * padding rule: if a field is small enough to fit in one 256-bit EVM word, but
   * placing it at the current offset would cause it to straddle a word boundary,
   * the offset is padded forward to the next byte boundary to prevent the straddle.
   *
   * This ensures that any field <= 256 bits can always be read with a single
   * `mload`/`sload` instruction, which is important for gas optimization.
   *
   * @param indexOrNameOrNode - Child index, `labelFromParent` name, or node reference
   * @returns Bit offset, or `undefined` if any child along the way has unknown size
   *
   * @example
   * // struct { uint200 a; uint200 b; }
   * // a: offset 0, size 200 → fits in one word at offset 0
   * // b: size 200, offset would be 200 → 200 + (200 % 8=0) is fine,
   * //    but 200 + 200 = 400 > 256, so b straddles the 256-bit boundary.
   * //    Pad offset to 256 → b starts at bit 256, readable in one word.
   */
  exactBitsOffsetOfChild(indexOrNameOrNode: string | number | T): number | undefined {
    const index = this.requireFindChildIndex(indexOrNameOrNode);
    let offset = 0;
    for (let i = 0; i <= index; i++) {
      const member = this.ownChildren[i];
      const size = member.exactBits;
      if (size === undefined) return undefined;

      // Word-boundary padding: if this field fits in one 256-bit word (size <= 256),
      // but the current bit offset within the word would cause the field to cross
      // the word boundary (size + sub-byte remainder > 256), advance the offset to
      // the next byte boundary. This guarantees single-word reads for small fields.
      if (size <= 256 && size + (offset % 8) > 256) {
        offset += 8 - (offset % 8);
      }
      if (i < index) offset += size;
    }
    return offset;
  }

  /**
   * Computes the ABI calldata byte offset of a child's head slot.
   *
   * Sums `calldataHeadSize` of all preceding siblings. For statically-encoded children
   * this is the offset to their inline value; for dynamically-encoded children this is
   * the offset to their 32-byte tail pointer.
   *
   * @see `Type::calldataHeadSize()` in solc Types.h:256
   */
  calldataOffsetOfChild(indexOrNameOrNode: string | number | T): number {
    const index = this.requireFindChildIndex(indexOrNameOrNode);
    let offset = 0;
    for (let i = 0; i < index; i++) {
      const member = this.ownChildren[i];
      offset += member.calldataHeadSize;
    }
    return offset;
  }

  /**
   * Computes the memory byte offset of a child's head slot.
   *
   * In Solidity memory, every value occupies a 32-byte slot (either an inline value
   * or a pointer to a data area), so this is simply `index * 32`.
   */
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

/** Configuration for getter/setter code generation strategies. */
export type Accessors = {
  getterCoderType?: CoderType;
  setterCoderType?: CoderType;
};

/**
 * Encoding validation strategy for generated accessor code:
 * - `"checked"`: Validates values against type constraints (e.g., range checks)
 * - `"unchecked"`: No validation — trusts the caller
 * - `"exact"`: Uses exact bit-width operations (no padding)
 */
export type CoderType = "checked" | "unchecked" | "exact";
