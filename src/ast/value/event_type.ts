import { keccak256 } from "@ethersproject/keccak256";
import { toUtf8Bytes } from "@ethersproject/strings";
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
  exactBits = 192;

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

  get eventSignature(): string {
    return [this.name, this.parameters?.signatureInExternalFunction(false) ?? "()"].join("");
  }

  get eventSelector(): string {
    const signature = this.eventSignature;
    return keccak256(toUtf8Bytes(signature)).slice(0, 10);
  }
}
