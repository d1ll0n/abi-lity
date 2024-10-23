import { StructuredDocumentation } from "solc-typed-ast";
import { ABITypeKind } from "../../constants";
import { TypeProvider } from "../type_provider";
import { IntegerType } from "./integer_type";
import { ValueType } from "./value_type";

export class EnumType extends ValueType {
  readonly kind = ABITypeKind.Enum;
  name: string;
  members: string[];
  leftAligned = false;

  constructor(
    name: string,
    members: string[],
    public documentation?: string | StructuredDocumentation
  ) {
    super();
    this.name = name;
    this.members = members;
  }

  copy(): EnumType {
    return new EnumType(this.name, [...this.members]);
  }

  get exactBits(): number {
    return Math.ceil(Math.log2(this.members.length));
  }

  get encodingType(): IntegerType {
    if (this.members.length > 256) throw Error(`Enum is too large`);
    return TypeProvider.uint(8);
  }

  signatureInExternalFunction(structsByName: boolean): string {
    if (structsByName) return this.name;
    return this.encodingType.canonicalName;
  }

  get canonicalName(): string {
    return this.name;
  }

  writeDefinition(): string {
    const memberTypeStrings = this.members.join(", ");
    return [`enum ${this.name} { `, memberTypeStrings, " }"].join(" ");
  }

  min(): bigint {
    return 0n;
  }

  max(): bigint {
    return BigInt(this.members.length - 1);
  }
}
