import { StructuredDocumentation } from "solc-typed-ast";
import { ABITypeKind } from "../../constants";
import { TypeNode } from "../type_node";
import { TupleLikeType } from "./tuple_type";

/**
 * Represents a Solidity struct type definition.
 *
 * Structs are ABI-encoded like tuples — members are encoded sequentially using the
 * head/tail pattern. The key difference from tuples is that structs have a `name` and
 * their members have names (stored as `labelFromParent` on each child TypeNode).
 *
 * In solc's ABIFunctions.cpp, struct encoding is handled by `abiEncodingFunctionStruct()`,
 * which iterates members and applies location-specific access patterns (mload for memory,
 * sload+extract for storage, calldataload for calldata).
 *
 * Maps to `StructType` in solc Types.h:1029.
 */
export class StructType extends TupleLikeType {
  readonly kind = ABITypeKind.Struct;

  /** Struct name (e.g., `"OrderComponents"`). */
  name: string;

  /** Optional override for the ABI canonical name (used when the struct has a qualified name). */
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
