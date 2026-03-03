import { ABITypeKind } from "../../constants";
import { TypeNode } from "../type_node";
import { ValueType } from "./value_type";

/**
 * Represents a Solidity user-defined value type (e.g., `type MyUint is uint256`).
 *
 * User-defined value types wrap an underlying primitive value type and delegate all
 * encoding properties to it. The `name` is the user-defined name, while `underlyingType`
 * determines all ABI encoding behavior (size, alignment, range).
 *
 * The encoding type IS the underlying type — no additional wrapping occurs in ABI.
 */
export class UserDefinedValueType extends ValueType {
  readonly kind = ABITypeKind.UserDefined;

  constructor(
    /** User-defined type name (e.g., `"MyUint"`). */
    public name: string,
    /** The primitive value type this wraps (e.g., `IntegerType(256, false)` for `uint256`). */
    public underlyingType: ValueType
  ) {
    super();
  }

  get exactBits(): number | undefined {
    return this.underlyingType.exactBits;
  }

  get leftAligned(): boolean {
    return this.underlyingType.leftAligned;
  }

  get encodingType(): TypeNode | undefined {
    return this.underlyingType;
  }

  get canonicalName(): string {
    return this.name;
  }

  copy(): UserDefinedValueType {
    return new UserDefinedValueType(this.name, this.underlyingType);
  }

  min(): bigint | undefined {
    return this.underlyingType.min();
  }

  max(): bigint | undefined {
    return this.underlyingType.max();
  }

  signatureInExternalFunction(structsByName: boolean): string {
    return structsByName
      ? this.name
      : this.underlyingType.signatureInExternalFunction(structsByName);
  }
}
