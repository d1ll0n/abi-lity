import { StructuredDocumentation } from "solc-typed-ast";
import { ABITypeKind } from "../../constants";
import { TypeNode } from "../type_node";
import { TupleLikeType } from "./tuple_type";

export class StructType extends TupleLikeType {
  readonly kind = ABITypeKind.Struct;
  name: string;
  canonicalNameOverride?: string;

  constructor(
    members: TypeNode[],
    name: string,
    canonicalNameOverride?: string,
    public documentation?: string | StructuredDocumentation
  ) {
    super(members);
    this.name = name;
    this.canonicalNameOverride = canonicalNameOverride;
  }

  copy(): StructType {
    const struct = new StructType(
      this.vMembers.map((member) => {
        const copy = member.copy();
        copy.labelFromParent = member.labelFromParent;
        return copy;
      }),
      this.name,
      this.canonicalNameOverride
    );
    struct.labelFromParent = this.labelFromParent;
    return struct;
  }

  get canonicalName(): string {
    return this.canonicalNameOverride ?? this.name;
  }

  signatureInExternalFunction(_structsByName: boolean): string {
    console.log(`extfn signature ${this.name} :: ${_structsByName}`);
    if (_structsByName) return this.name;
    const memberTypeStrings = this.children.map((c) => c.signatureInExternalFunction(false));
    return "(" + memberTypeStrings.join(",") + ")";
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
