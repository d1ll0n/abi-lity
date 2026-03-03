import { DataLocation } from "solc-typed-ast";
import { ABITypeKind } from "../../constants";
import { TypeNode, TypeNodeWithChildren } from "../type_node";
import { sumBy } from "lodash";

/**
 * Shared abstract base for `TupleType` and `StructType`.
 *
 * Implements common ABI encoding logic for ordered collections of heterogeneous members:
 * - Dynamic encoding check: a tuple-like type is dynamically encoded if ANY member is
 * - Calldata size: sum of member calldata sizes (throws if any member is dynamic)
 * - Tail size: sum of member head sizes (the minimum head section for dynamic types)
 *
 * This mirrors the behavior of `StructType` and `TupleType` in solc's ABIFunctions.cpp,
 * where the tuple encoder iterates members and applies the head/tail pattern.
 */
export abstract class TupleLikeType extends TypeNodeWithChildren<TypeNode> {
  constructor(members: TypeNode[]) {
    super();

    for (const member of members) {
      this.appendChild(member);
    }
  }

  /** Alias for `ownChildren` — the ordered list of member types. */
  get vMembers(): TypeNode[] {
    return this.ownChildren;
  }

  get canonicalName(): string {
    return this.signatureInExternalFunction(true);
  }

  /**
   * A tuple-like type is dynamically encoded if any of its members is dynamically encoded.
   * This is the same check solc performs in `StructType::isDynamicallyEncoded()`.
   */
  get isDynamicallyEncoded(): boolean {
    return this.ownChildren.some((m) => m.isDynamicallyEncoded);
  }

  /**
   * Sum of all members' `calldataEncodedSize`. Only valid for fully static types.
   * @throws If any member is dynamically encoded.
   */
  get calldataEncodedSize(): number {
    if (this.isDynamicallyEncoded) {
      throw Error(`Can not read calldata size of dynamically encoded struct`);
    }
    return this.ownChildren.reduce((sum, member) => sum + member.calldataEncodedSize, 0);
  }

  /**
   * Minimum tail section size: sum of all members' `calldataHeadSize`.
   * For dynamic types, this is the size of the head section (which contains offset
   * pointers for dynamic members and inline values for static members).
   * @throws If the type is not dynamically encoded.
   */
  get calldataEncodedTailSize(): number {
    if (!this.isDynamicallyEncoded) {
      throw Error(`Can not read calldata tail of statically encoded struct`);
    }
    return this.ownChildren.reduce((sum, member) => sum + member.calldataHeadSize, 0);
  }

  get memoryDataSize(): number | undefined {
    let sum = 0;
    for (const member of this.ownChildren) {
      const size = member.memoryDataSize;
      if (size === undefined) return undefined;
      sum += size;
    }
    return sum;
  }

  get extendedMemoryDataSize(): number | undefined {
    let sum = 0;
    for (const member of this.ownChildren) {
      const size = member.extendedMemoryDataSize;
      if (size === undefined) return undefined;
      sum += size;
    }
    return sum;
  }

  signatureInExternalFunction(_structsByName: boolean): string {
    const memberTypeStrings = this.children.map((c) =>
      c.signatureInExternalFunction(_structsByName)
    );
    return "(" + memberTypeStrings.join(",") + ")";
  }

  signatureInInternalFunction(): string {
    const memberTypeStrings = this.children.map((c) => c.signatureInInternalFunction());
    return "(" + memberTypeStrings.join(",") + ")";
  }

  readonly encodingType = undefined;
  readonly isValueType = false;
  readonly leftAligned = false;
  readonly isDynamicallySized = false;
}

/**
 * Represents a Solidity tuple — typically used for function parameter and return type lists.
 *
 * Tuples are unnamed in ABI encoding: `(uint256,address,bytes)`. They serve as the container
 * for the head/tail-encoded sequence of types in function calldata and returndata.
 *
 * Corresponds to the tuple encoding in `ABIFunctions::tupleEncoder()` / `tupleDecoder()`.
 */
export class TupleType extends TupleLikeType {
  readonly kind = ABITypeKind.Tuple;

  get identifier(): string {
    return `tuple_${this.ownChildren.map((child) => child.identifier).join("_")}`;
  }

  /**
   * Returns indexed names like `["value0", "value1"]` or just `["value"]` for single-member tuples.
   * @param base Base prefix for generated names.
   */
  getIndexedNames(base: string): string[] {
    return this.vMembers.map((_, i) => (this.vMembers.length > 1 ? `${base}${i}` : base));
  }

  /**
   * Returns a name for each parameter, using `labelFromParent` if available, otherwise
   * falling back to `base<index>` (e.g., `"value0"`, `"value1"`).
   * @param base Base text for unnamed parameters, suffixed with the parameter index.
   */
  getParamNames(base: string): string[] {
    return this.vMembers.map(
      (member, i) => member.labelFromParent ?? (this.vMembers.length > 1 ? `${base}${i}` : base)
    );
  }

  copy(): TupleType {
    const tuple = new TupleType(this.ownChildren.map((member) => member.copy()));
    tuple.labelFromParent = this.labelFromParent;
    return tuple;
  }

  pp(): string {
    const memberTypeStrings = this.children.map((c) =>
      [c.signatureInExternalFunction(true), c.labelFromParent].filter(Boolean).join(" ")
    );
    return "(" + memberTypeStrings.join(",") + ")";
  }

  writeParameter(location: DataLocation): string {
    const childParameters = this.ownChildren.map((c) => c.writeParameter(location));
    return "(" + childParameters.join(", ") + ")";
  }
}
