import { ABITypeKind } from "../../constants";
import { TypeNode, TypeNodeWithChildren } from "../type_node";

export class TupleType extends TypeNodeWithChildren<TypeNode> {
  readonly kind = ABITypeKind.Tuple;

  // memberNames?: string[];

  constructor(members: TypeNode[]) {
    super();

    for (const member of members) {
      this.appendChild(member);
    }
    this.acceptChildren();
  }

  copy(): TupleType {
    return new TupleType(this.ownChildren.map((member) => member.copy()));
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

  calldataOffsetOfMember(index: number): number {
    if (index > this.ownChildren.length - 1) {
      throw Error(`Index out of bounds: ${index}`);
    }
    let offset = 0;
    for (let i = 0; i < index; i++) {
      const member = this.ownChildren[i];
      offset += member.calldataHeadSize;
    }
    return offset;
  }

  memoryOffsetOfMember(index: number): number {
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

  pp(): string {
    const memberTypeStrings = this.children.map((c, i) =>
      [c.signatureInExternalFunction(true), c.labelFromParent].filter(Boolean).join(" ")
    );
    return "(" + memberTypeStrings.join(",") + ")";
  }

  readonly encodingType = undefined;
  readonly unpaddedSize = undefined;
  readonly isValueType = false;
  readonly leftAligned = false;
  readonly isDynamicallySized = false;
}
