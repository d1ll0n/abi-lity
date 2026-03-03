import { StructuredDocumentation } from "solc-typed-ast";
import { ABITypeKind } from "../../constants";
import { TypeProvider } from "../type_provider";
import { IntegerType } from "./integer_type";
import { ValueType } from "./value_type";

/**
 * Represents a Solidity `enum` type.
 *
 * Enums are encoded as the smallest unsigned integer that can represent all members.
 * Since Solidity caps enums at 256 members, the encoding type is always `uint8`.
 * The `exactBits` is the minimum number of bits to distinguish all members:
 * `ceil(log2(memberCount))`.
 *
 * Maps to `EnumType` in solc Types.h:1094.
 */
export class EnumType extends ValueType {
  readonly kind = ABITypeKind.Enum;

  /** The enum's declared name (e.g., `"OrderType"`). */
  name: string;

  /** Ordered list of member names (e.g., `["BUY", "SELL"]`). */
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

  /** Minimum bits to represent all members: `ceil(log2(memberCount))`. */
  get exactBits(): number {
    return Math.ceil(Math.log2(this.members.length));
  }

  /**
   * Enums encode as `uint8` in ABI calldata. Solidity requires enums
   * to have at most 256 members.
   */
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

  /** Generates Solidity enum definition source, e.g. `enum OrderType { BUY, SELL }`. */
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
