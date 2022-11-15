import { ABITypeKind } from "../../constants";
import { TupleType } from "../reference";
import { TypeNode } from "../type_node";
import { ValueType } from ".";

export class EventType extends ValueType {
  readonly kind = ABITypeKind.Event;

  name: string;
  parameters?: TupleType;

  leftAligned = false;
  encodingType = undefined;
  unpaddedSize = 24;

  constructor(name: string, parameters?: TupleType) {
    super();
    this.name = name;
    this.parameters = parameters;
    this.acceptChildren();
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
}
