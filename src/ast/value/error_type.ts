import { keccak256 } from "@ethersproject/keccak256";
import { toUtf8Bytes } from "@ethersproject/strings";
import { ABITypeKind } from "../../constants";
import { TupleType } from "../reference";
import { TypeNode } from "../type_node";
import { ValueType } from "./value_type";
import { StructuredDocumentation } from "solc-typed-ast";

/**
 * Represents a Solidity custom error definition (e.g., `error InsufficientBalance(uint256)`).
 *
 * Custom errors use a 4-byte selector (first 4 bytes of `keccak256(signature)`) followed
 * by ABI-encoded parameters, identical to function call encoding. This makes error decoding
 * use the same mechanism as function input decoding.
 */
export class ErrorType extends ValueType {
  readonly kind = ABITypeKind.Error;

  /** Error name (e.g., `"InsufficientBalance"`). */
  name: string;

  /** Tuple of parameter types. `undefined` for parameterless errors. */
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

  /** Full error signature string, e.g. `"InsufficientBalance(uint256)"`. */
  get errorSignature(): string {
    return [this.name, this.parameters?.signatureInExternalFunction(false) ?? "()"].join("");
  }

  /**
   * The 4-byte error selector: first 4 bytes of `keccak256(signature)`.
   * Returned as a hex string (e.g., `"0xcf479181"`).
   */
  get errorSelector(): string {
    const signature = this.errorSignature;
    return keccak256(toUtf8Bytes(signature)).slice(0, 10);
  }

  writeDefinition(): string {
    const memberTypeStrings = this.children.map((c) => c.signatureInExternalFunction(true));
    return [`error ${this.name} (`, memberTypeStrings, ")"].join("");
  }
}
