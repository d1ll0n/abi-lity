import { keccak256 } from "@ethersproject/keccak256";
import { toUtf8Bytes } from "@ethersproject/strings";
import { ABITypeKind } from "../../constants";
import { TupleType } from "../reference";
import { TypeNode } from "../type_node";
import { ValueType } from "./value_type";
import { StructuredDocumentation } from "solc-typed-ast";

export class ErrorType extends ValueType {
  readonly kind = ABITypeKind.Error;

  name: string;
  parameters?: TupleType;

  leftAligned = false;
  encodingType = undefined;
  exactBits = 192;

  constructor(
    name: string,
    parameters?: TupleType,
    public documentation?: string | StructuredDocumentation
  ) {
    super();
    this.name = name;
    this.parameters = parameters;
    this.acceptChildren();
  }

  copy(): ErrorType {
    return new ErrorType(this.name, this.parameters?.copy());
  }

  get children(): TypeNode[] {
    return this.pickNodes(this.parameters);
  }

  get canonicalName(): string {
    return this.name;
  }

  signatureInExternalFunction(_structsByName: boolean): string {
    const memberTypeStrings = this.children.map((c) =>
      c.signatureInExternalFunction(_structsByName)
    );
    const prefix = _structsByName ? `error ${this.name}` : `error`;
    return `${prefix} (` + memberTypeStrings.join(",") + ")";
  }

  get errorSignature(): string {
    return [this.name, this.parameters?.signatureInExternalFunction(false) ?? "()"].join("");
  }

  get errorSelector(): string {
    const signature = this.errorSignature;
    return keccak256(toUtf8Bytes(signature)).slice(0, 10);
  }

  writeDefinition(): string {
    const memberTypeStrings = this.children.map((c) => c.signatureInExternalFunction(true));
    return [`error ${this.name} (`, memberTypeStrings, ")"].join("");
  }
}
