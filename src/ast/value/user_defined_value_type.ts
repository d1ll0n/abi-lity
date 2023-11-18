import { ABITypeKind } from "../../constants";
import { TypeNode } from "../type_node";
import { ValueType } from "./value_type";

export class UserDefinedValueType extends ValueType {
  readonly kind = ABITypeKind.UserDefined;
  // exactBits = 1;
  // leftAligned = false;
  // encodingType = undefined;
  // canonicalName = "bool";

  constructor(public name: string, public underlyingType: ValueType) {
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
