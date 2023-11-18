import { DataLocation } from "solc-typed-ast";
import { ABITypeKind } from "../../constants";
import { TypeNode, TypeNodeWithChildren } from "../type_node";
import { sumBy } from "lodash";

export abstract class TupleLikeType extends TypeNodeWithChildren<TypeNode> {
  constructor(members: TypeNode[]) {
    super();

    for (const member of members) {
      this.appendChild(member);
    }
  }

  get vMembers(): TypeNode[] {
    return this.ownChildren;
  }

  get canonicalName(): string {
    return this.signatureInExternalFunction(true);
  }

  get isDynamicallyEncoded(): boolean {
    return this.ownChildren.some((m) => m.isDynamicallyEncoded);
  }

  get calldataEncodedSize(): number {
    if (this.isDynamicallyEncoded) {
      throw Error(`Can not read calldata size of dynamically encoded struct`);
    }
    return this.ownChildren.reduce((sum, member) => sum + member.calldataEncodedSize, 0);
  }

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

export class TupleType extends TupleLikeType {
  readonly kind = ABITypeKind.Tuple;

  get identifier(): string {
    return `tuple_${this.ownChildren.map((child) => child.identifier).join("_")}`;
  }

  getIndexedNames(base: string): string[] {
    return this.vMembers.map((_, i) => (this.vMembers.length > 1 ? `${base}${i}` : base));
  }

  /**
   * Get a list of names for the tuple parameters, using `base<index>` for unnamed parameters
   * @param base Base text to use for parameters without names, suffixed with index
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
