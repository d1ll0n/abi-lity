import { keccak256 } from "@ethersproject/keccak256";
import { toUtf8Bytes } from "@ethersproject/strings";
import {
  DataLocation,
  FunctionStateMutability,
  FunctionVisibility,
  StructuredDocumentation
} from "solc-typed-ast";
import { ABITypeKind } from "../../constants";
import { TupleType } from "../reference";
import { TypeNode } from "../type_node";
import { ValueType } from "../value/value_type";

/**
 * Represents a Solidity external function type (name, parameters, returns, selector).
 *
 * In ABI encoding, an external function value is 24 bytes (192 bits): 20 bytes for the
 * contract address + 4 bytes for the function selector. This is right-aligned in a 32-byte word.
 *
 * Also used as a container for function signature metadata — `parameters` and `returnParameters`
 * are `TupleType` nodes that describe the function's calldata/returndata layout.
 *
 * Maps to `FunctionType` in solc Types.h:1253.
 */
export class FunctionType extends ValueType {
  readonly kind = ABITypeKind.Function;

  /** Function name (e.g., `"transfer"`). */
  name: string;

  /** Tuple of parameter types. `undefined` for parameterless functions. */
  parameters?: TupleType;

  /** Tuple of return types. `undefined` for functions with no return values. */
  returnParameters?: TupleType;

  visibility?: FunctionVisibility;
  stateMutability?: FunctionStateMutability;

  leftAligned = false;
  encodingType = undefined;

  /** 192 bits = 24 bytes (20-byte address + 4-byte selector). */
  exactBits = 192;

  constructor(
    name: string,
    parameters?: TupleType,
    returnParameters?: TupleType,
    visibility?: FunctionVisibility,
    stateMutability?: FunctionStateMutability,
    public documentation?: string | StructuredDocumentation
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

  writeParameter(location: DataLocation, name?: string | undefined): string {
    return [this.signatureInInternalFunction(), name].join(" ");
  }

  /** Full function signature string, e.g. `"transfer(address,uint256)"`. */
  get functionSignature(): string {
    return this.signature(false);
  }

  /**
   * The 4-byte function selector: first 4 bytes of `keccak256(signature)`.
   * Returned as a hex string (e.g., `"0xa9059cbb"`).
   */
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
