import { keccak256 } from "@ethersproject/keccak256";
import { toUtf8Bytes } from "@ethersproject/strings";
import { ABITypeKind } from "../../constants";
import { TupleType } from "../reference";
import { TypeNode } from "../type_node";
import { ValueType } from "./value_type";
import _ from "lodash";
import { DataLocation, StructuredDocumentation } from "solc-typed-ast";

export class EventType extends ValueType {
  readonly kind = ABITypeKind.Event;

  name: string;
  parameters?: TupleType;
  unindexedParameters: TypeNode[];
  indexedParameters: TypeNode[];

  leftAligned = false;
  encodingType = undefined;
  exactBits = 192;
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

  get eventSignature(): string {
    return [this.name, this.parameters?.signatureInExternalFunction(false) ?? "()"].join("");
  }

  get eventSelector(): string {
    const signature = this.eventSignature;
    return keccak256(toUtf8Bytes(signature));
  }

  writeDefinition(): string {
    const memberTypeStrings = this.parameters?.writeParameter(DataLocation.Default) ?? "()";
    /* this.children.map((c) => {
        const typeString = c.signatureInExternalFunction(true);
        return [typeString, c.isIndexed ? " indexed" : ""].join("");
      }) */
    return [`event ${this.name} `, memberTypeStrings].join("");
  }
}
