import { TypeNode } from "../type_node";

/**
 * Abstract base class for types that are not value types and can be stored in storage,
 * memory, or calldata. In abi-lity, this is the base for `BytesType` and `StringType`.
 *
 * Reference types differ from value types in several key ways:
 * - They may be dynamically sized (unknown length at compile time)
 * - They may be dynamically encoded (requiring head/tail indirection in ABI)
 * - In memory, they are represented as pointers to data areas (not inline values)
 * - In calldata, dynamic reference types use offset pointers in the head section
 *
 * Note: `ArrayType`, `StructType`, and `TupleType` do NOT extend this class directly —
 * they extend `TypeNodeWithChildren` instead. This class is primarily used by `BytesType`
 * and `StringType`, which are leaf nodes (no children in the type tree).
 *
 * Corresponds to types where `Type::isValueType()` returns `false` in solc Types.h:304.
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
