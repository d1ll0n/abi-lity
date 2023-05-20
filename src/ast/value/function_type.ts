import { keccak256 } from "@ethersproject/keccak256";
import { toUtf8Bytes } from "@ethersproject/strings";
import { DataLocation, FunctionStateMutability, FunctionVisibility } from "solc-typed-ast";
import { ABITypeKind } from "../../constants";
import { TupleType } from "../reference";
import { TypeNode } from "../type_node";
import { ValueType } from "../value/value_type";

export class FunctionType extends ValueType {
  readonly kind = ABITypeKind.Function;

  name: string;
  parameters?: TupleType;
  returnParameters?: TupleType;
  visibility?: FunctionVisibility;
  stateMutability?: FunctionStateMutability;

  leftAligned = false;
  encodingType = undefined;
  exactBits = 192;

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
    return "function";
  }

  signature(_structsByName: boolean): string {
    return [this.name, this.parameters?.signatureInExternalFunction(_structsByName) ?? "()"].join(
      ""
    );
  }

  signatureInInternalFunction(): string {
    const modifiers = [
      this.visibility !== FunctionVisibility.Default && this.visibility,
      this.stateMutability !== FunctionStateMutability.NonPayable && this.stateMutability,
      (this.returnParameters?.vMembers ?? []).length > 0 &&
        `returns${this.returnParameters!.signatureInInternalFunction()}`
    ]
      .filter(Boolean)
      .join(" ");
    return [`function`, this.parameters?.signatureInInternalFunction() ?? "()", modifiers].join("");
  }

  internalSignature(): string {
    return [`function ${this.name}`, this.parameters?.signatureInInternalFunction() ?? "()"].join(
      ""
    );
  }

  writeDefinition(): string {
    return [
      `function ${this.name}`,
      this.parameters?.writeParameter(DataLocation.CallData) ?? "()",
      this.visibility !== FunctionVisibility.Default && this.visibility,
      this.stateMutability !== "nonpayable" && this.stateMutability,
      this.returnParameters &&
        `returns ${this.returnParameters.writeParameter(DataLocation.Memory)}`
    ]
      .filter(Boolean)
      .join(" ");
  }

  get functionSignature(): string {
    return this.signature(false);
  }

  get functionSelector(): string {
    const signature = this.functionSignature;
    return keccak256(toUtf8Bytes(signature)).slice(0, 10);
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
