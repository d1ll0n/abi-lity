import { ABITypeKind } from "../../constants";
import { TypeNode } from "../type_node";
import { ReferenceType } from "./reference_type";

export class StructType extends ReferenceType {
  readonly kind = ABITypeKind.Struct;
  name: string;

  members: TypeNode[] = [];
  memberNames: string[] = [];

  constructor(members: TypeNode[], memberNames: string[], name: string) {
    super();
    this.name = name;
    if (members.length !== memberNames.length) {
      throw Error(`Struct must have same number of members and names`);
    }
    for (let i = 0; i < memberNames.length; i++) {
      this.memberNames.push(memberNames[i]);
      this.members.push(members[i]);
    }
    this.acceptChildren();
  }

  copy(): StructType {
    return new StructType(
      this.members.map((member) => member.copy()),
      [...this.memberNames],
      this.name
    );
  }

  get children(): TypeNode[] {
    return this.pickNodes(this.members);
  }

  get canonicalName(): string {
    return this.name;
  }

  get isDynamicallyEncoded(): boolean {
    return this.members.some((m) => m.isDynamicallyEncoded);
  }

  get calldataEncodedSize(): number {
    if (this.isDynamicallyEncoded) {
      throw Error(`Can not read calldata size of dynamically encoded struct`);
    }
    return this.members.reduce((sum, member) => sum + member.calldataEncodedSize, 0);
  }

  get calldataEncodedTailSize(): number {
    if (!this.isDynamicallyEncoded) {
      throw Error(`Can not read calldata tail of statically encoded struct`);
    }
    return this.members.reduce((sum, member) => sum + member.calldataHeadSize, 0);
  }

  get memoryDataSize(): number | undefined {
    let sum = 0;
    for (const member of this.members) {
      const size = member.memoryDataSize;
      if (size === undefined) return undefined;
      sum += size;
    }
    return sum;
  }

  get extendedMemoryDataSize(): number | undefined {
    let sum = 0;
    for (const member of this.members) {
      const size = member.extendedMemoryDataSize;
      if (size === undefined) return undefined;
      sum += size;
    }
    return sum;
  }

  signatureInExternalFunction(_structsByName: boolean): string {
    if (_structsByName) return this.canonicalName;
    const memberTypeStrings = this.children.map((c) =>
      c.signatureInExternalFunction(_structsByName)
    );
    return "(" + memberTypeStrings.join(",") + ")";
  }

  calldataOffsetOfMember(name: string): number {
    let offset = 0;
    for (let i = 0; i < this.memberNames.length; i++) {
      const member = this.members[i];
      if (this.memberNames[i] === name) {
        return offset;
      } else {
        offset += member.calldataHeadSize;
      }
    }
    throw Error(`Member ${name} not found in struct`);
  }

  memoryOffsetOfMember(name: string): number {
    let offset = 0;
    for (let i = 0; i < this.memberNames.length; i++) {
      const member = this.members[i];
      if (this.memberNames[i] === name) {
        return offset;
      } else {
        offset += member.memoryHeadSize;
      }
    }
    throw Error(`Member ${name} not found in struct`);
  }

  encodingType = undefined;
  unpaddedSize = undefined;
  isDynamicallySized = false;
}
