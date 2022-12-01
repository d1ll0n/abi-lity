import { ABITypeKind } from "../../constants";
import { TypeNode } from "../type_node";
import { TupleLikeType } from "./tuple_type";

export class StructType extends TupleLikeType {
  readonly kind = ABITypeKind.Struct;
  name: string;

  constructor(members: TypeNode[], name: string) {
    super(members);
    this.name = name;
  }

  copy(): StructType {
    const struct = new StructType(
      this.vMembers.map((member) => {
        const copy = member.copy();
        copy.labelFromParent = member.labelFromParent;
        return copy;
      }),
      this.name
    );
    struct.labelFromParent = this.labelFromParent;
    return struct;
  }

  get canonicalName(): string {
    return this.name;
  }

  pp(): string {
    const memberTypeStrings = this.children.map(
      (c, i) => `  ` + [c.canonicalName, c.labelFromParent].filter(Boolean).join(" ") + ";"
    );
    return [`struct ${this.name} {`, ...memberTypeStrings, "}"].join("\n");
  }

  writeDefinition(): string {
    const memberTypeStrings = this.children.map(
      (c, i) => `  ` + [c.canonicalName, c.labelFromParent].filter(Boolean).join(" ") + ";"
    );
    return [`struct ${this.name} {`, ...memberTypeStrings, "}"].join("\n");
  }
}
