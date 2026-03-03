import { keccak256 } from "@ethersproject/keccak256";
import { toUtf8Bytes } from "@ethersproject/strings";
import { ABITypeKind } from "../../constants";
import { TupleType } from "../reference";
import { TypeNode } from "../type_node";
import { ValueType } from "./value_type";
import _ from "lodash";
import { StructuredDocumentation } from "solc-typed-ast";

/**
 * Represents a Solidity event definition.
 *
 * Events use log-based encoding (not standard ABI), but abi-lity models them here for
 * signature computation and parameter analysis. Indexed parameters go into log topics
 * (topic1–topic3), while unindexed parameters are ABI-encoded into the log data section.
 *
 * For non-anonymous events, `topic0` is the keccak256 hash of the event signature (the
 * "event selector"). Anonymous events have no topic0 and can use all 4 topics for
 * indexed parameters.
 */
export class EventType extends ValueType {
  readonly kind = ABITypeKind.Event;

  /** Event name (e.g., `"Transfer"`). */
  name: string;

  /** Tuple of all parameter types (indexed + unindexed). */
  parameters?: TupleType;

  /** Parameters that go into log data (ABI-encoded). */
  unindexedParameters: TypeNode[];

  /** Parameters that go into log topics (topic1, topic2, topic3). */
  indexedParameters: TypeNode[];

  leftAligned = false;
  encodingType = undefined;
  exactBits = 192;

  /** Whether this is an `anonymous` event (no topic0 selector). */
  anonymous = false;

  constructor(
    name: string,
    parameters?: TupleType,
    anonymous?: boolean,
    public documentation?: string | StructuredDocumentation
  ) {
    super();
    this.name = name;
    [this.indexedParameters, this.unindexedParameters] = _.partition(
      parameters?.vMembers ?? [],
      (m) => m.isIndexed
    );
    this.parameters = parameters;
    this.acceptChildren();
    this.anonymous = anonymous ?? false;
    const paramNames = this.parameters?.getParamNames("value") ?? [];

    parameters?.vMembers.forEach((m, i) => {
      if (!m.labelFromParent) {
        m.labelFromParent = paramNames[i];
      }
    });
  }

  /**
   * The event's topic0 — keccak256 of the full event signature.
   * Returns `undefined` for anonymous events (which have no topic0).
   */
  get topic0(): string | undefined {
    if (this.anonymous) {
      return undefined;
    }
    return this.eventSelector;
  }

  copy(): EventType {
    return new EventType(this.name, this.parameters?.copy());
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
    const prefix = _structsByName ? `event ${this.name}` : `event`;
    return `${prefix} (` + memberTypeStrings.join(",") + ")";
  }

  /** Full event signature string, e.g. `"Transfer(address,address,uint256)"`. */
  get eventSignature(): string {
    return [this.name, this.parameters?.signatureInExternalFunction(false) ?? "()"].join("");
  }

  /**
   * Full keccak256 hash of the event signature (all 32 bytes).
   * Unlike function selectors (4 bytes), event selectors use the full hash.
   */
  get eventSelector(): string {
    const signature = this.eventSignature;
    return keccak256(toUtf8Bytes(signature));
  }

  writeDefinition(): string {
    const memberTypeStrings = this.parameters?.signatureInExternalFunction(true) ?? "()";
    /* this.children.map((c) => {
        const typeString = c.signatureInExternalFunction(true);
        return [typeString, c.isIndexed ? " indexed" : ""].join("");
      }) */
    return [`event ${this.name} `, memberTypeStrings].join("");
  }
}
