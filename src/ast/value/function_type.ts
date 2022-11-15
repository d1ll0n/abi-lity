import { FunctionStateMutability, FunctionVisibility } from "solc-typed-ast";
import { ABITypeKind } from "../../constants";
import { TupleType } from "../reference";
import { TypeNode } from "../type_node";
import { ValueType } from "../value";

export class FunctionType extends ValueType {
  readonly kind = ABITypeKind.Function;

  name: string;
  parameters?: TupleType;
  returnParameters?: TupleType;
  visibility?: FunctionVisibility;
  stateMutability?: FunctionStateMutability;

  leftAligned = false;
  encodingType = undefined;
  unpaddedSize = 24;

  constructor(
    name: string,
    parameters?: TupleType,
    returnParameters?: TupleType,
    visibility?: FunctionVisibility,
    stateMutability?: FunctionStateMutability
  ) {
    super();
    this.name = name;
    this.parameters = parameters;
    this.returnParameters = returnParameters;
    this.visibility = visibility;
    this.stateMutability = stateMutability;
    this.acceptChildren();
  }

  copy(): FunctionType {
    return new FunctionType(
      this.name,
      this.parameters?.copy(),
      this.returnParameters?.copy(),
      this.visibility,
      this.stateMutability
    );
  }

  get children(): TypeNode[] {
    return this.pickNodes(this.parameters, this.returnParameters);
  }

  get canonicalName(): string {
    return this.name;
  }

  signatureInExternalFunction(): string {
    return this.name;
  }

  pp(): string {
    return [
      `function ${this.name}`,
      this.parameters ? this.parameters.pp() : "()",
      this.returnParameters && ` returns ${this.returnParameters.pp()}`
    ]
      .filter(Boolean)
      .join("");
  }
}
