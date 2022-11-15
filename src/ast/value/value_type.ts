import { TypeNode } from "../type_node";

export abstract class ValueType extends TypeNode {
  isValueType = true;

  calldataEncodedSize = 32;

  isDynamicallyEncoded = false;

  isDynamicallySized = false;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  signatureInExternalFunction(structsByName: boolean): string {
    return this.canonicalName;
  }

  get calldataEncodedTailSize(): number {
    throw Error(`Value types do not have calldata tail`);
  }
}
