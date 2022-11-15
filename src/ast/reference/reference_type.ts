import { TypeNode } from "../type_node";

/**
 * Base class used by types which are not value types and can be stored either in storage, memory
 * or calldata. This is currently used by arrays and structs.
 */
export abstract class ReferenceType extends TypeNode {
  isValueType = false;
  leftAligned = false;

  constructor() {
    super();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  signatureInExternalFunction(structsByName: boolean): string {
    return this.canonicalName;
  }
}
