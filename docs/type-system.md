# abi-lity Type System

This guide covers the TypeNode hierarchy in `src/ast/` — the central data structure that
drives all code generation in abi-lity.

## Overview

Every Solidity type that participates in ABI encoding is represented as a `TypeNode`. These nodes
form trees: a struct's TypeNode contains its members as children, a tuple contains its parameters,
and an array contains its base type. The tree structure lets abi-lity compute offsets, sizes, and
encoding strategies by walking the type hierarchy.

The TypeNode system mirrors solc's C++ `Type` class hierarchy from `libsolidity/ast/Types.h`,
but adds encoding-specific metadata as first-class properties rather than computing them at
code generation time. This is the key design difference: solc computes offsets dynamically in
generated Yul code, while abi-lity precomputes them as constants on the type tree.

## Class Hierarchy

```
Node                              (src/ast/node.ts)
  Base tree node: id, parent, children, walk(), getChildrenByType(), etc.
  Adapted from solc-typed-ast's ASTNode.

└── TypeNode                      (src/ast/type_node.ts)
      Abstract base for all ABI types. Carries encoding metadata.

    ├── ValueType                 (src/ast/value/value_type.ts)
    │     Always 32 bytes in calldata. Never dynamically encoded.
    │     No tail section. Right-aligned (except FixedBytesType).
    │
    │   ├── IntegerType           uint8–uint256, int8–int256
    │   ├── BoolType              bool (1 bit, right-aligned)
    │   ├── AddressType           address / address payable (160 bits)
    │   │   └── ContractType      Contract names (encodes as address)
    │   ├── FixedBytesType        bytes1–bytes32 (LEFT-aligned — the exception)
    │   ├── EnumType              Enums (encodes as smallest fitting uint)
    │   ├── UserDefinedValueType  User-defined value types (delegates to underlying)
    │   ├── FunctionType          External functions: name, params, returns, selector
    │   ├── EventType             Events: name, params, topic0/selector
    │   └── ErrorType             Custom errors: name, params, selector
    │
    ├── TypeNodeWithChildren<T>   (src/ast/type_node.ts)
    │     Manages ordered child nodes with offset calculations.
    │
    │   └── TupleLikeType         (src/ast/reference/tuple_type.ts)
    │         Shared base for structs and tuples.
    │
    │       ├── TupleType         Function parameter/return tuples
    │       └── StructType        Named struct definitions
    │
    ├── ArrayType                 (src/ast/reference/array_type.ts)
    │     Fixed-size (T[N]) and dynamic (T[]) arrays.
    │     Extends TypeNodeWithChildren directly.
    │
    ├── ReferenceType             (src/ast/reference/reference_type.ts)
    │     Abstract base for non-value types.
    │
    │   ├── BytesType             bytes (dynamic byte array)
    │   └── StringType            string (extends BytesType)
    │
    └── (Supporting)
        ├── ASTContext            Node registry / ID→node lookup
        └── TypeProvider          Factory shortcuts
```

## Encoding Metadata Properties

These properties on `TypeNode` drive every encoding/decoding decision. They map directly to
virtual methods on solc's `Type` base class in `Types.h`.

### Classification Properties

| Property | Type | solc Equivalent | Meaning |
|----------|------|-----------------|---------|
| `isValueType` | `boolean` | `Type::isValueType()` (Types.h:304) | Single-slot value, not a reference type |
| `isDynamicallyEncoded` | `boolean` | `Type::isDynamicallyEncoded()` (Types.h:273) | Needs head offset + tail data in ABI encoding |
| `isDynamicallySized` | `boolean` | `Type::isDynamicallySized()` (Types.h:271) | Length unknown at compile time (dynamic arrays, bytes, string) |
| `leftAligned` | `boolean` | `Type::leftAligned()` (Types.h:293) | Data is left-aligned in 32-byte word (only `bytes1`-`bytes32`) |

### `isDynamicallyEncoded` vs `isDynamicallySized`

These two properties are often confused but have distinct meanings:

- **`isDynamicallySized`**: The type's **length** is not known at compile time.
  - `true` for: `uint256[]`, `bytes`, `string`
  - `false` for: `uint256[5]`, `uint256`, `(uint256, bytes)` (tuple)

- **`isDynamicallyEncoded`**: The type requires the **head/tail encoding pattern** in ABI.
  - `true` for: `uint256[]`, `bytes`, `string`, `uint256[5]` where base is dynamic,
    any struct/tuple containing a dynamic member
  - `false` for: `uint256`, `uint256[5]` (with static base), structs of only value types

A type can be dynamically encoded without being dynamically sized. For example, `bytes32[][3]`
(a fixed-size array of dynamic arrays) is not dynamically sized (length is 3) but IS dynamically
encoded (each element needs a tail pointer). The converse is not possible — any dynamically sized
type is always dynamically encoded.

**In ArrayType:**
```typescript
get isDynamicallyEncoded(): boolean {
  return this.isDynamicallySized || this.baseType.isDynamicallyEncoded;
}
```

**In TupleLikeType (structs and tuples):**
```typescript
get isDynamicallyEncoded(): boolean {
  return this.ownChildren.some(m => m.isDynamicallyEncoded);
}
```

### Size Properties

| Property | Type | solc Equivalent | Meaning |
|----------|------|-----------------|---------|
| `exactBits` | `number \| undefined` | — | Exact bits to represent the data (irrespective of ABI padding). `undefined` for dynamic types. |
| `packedBits` | `number \| undefined` | — | `exactBits` rounded up to byte boundary (× 8). Used for packed encoding. |
| `packedSize` | `number \| undefined` | — | `packedBits / 8`. Byte count in packed encoding. |
| `exactBytes` | `number \| undefined` | — | `ceil(exactBits / 8)`. |
| `calldataEncodedSize` | `number` | `Type::calldataEncodedSize(true)` (Types.h:249) | Padded byte size in ABI calldata. Throws for dynamic types. |
| `calldataEncodedTailSize` | `number` | — | Minimum tail section size. Only valid for dynamically encoded types. |
| `calldataHeadSize` | `number` | `Type::calldataHeadSize()` (Types.h:256) | 32 if dynamic (offset pointer), else `calldataEncodedSize`. |
| `memoryHeadSize` | `number` | — | Always 32 (pointer or padded value). |
| `memoryDataSize` | `number \| undefined` | — | Data area size in memory. `undefined` for dynamic types. |

**How calldataHeadSize works:**

In ABI encoding, each element in a tuple/struct occupies a "head slot." For statically encoded
types, the head slot contains the value itself. For dynamically encoded types, the head slot
contains a 32-byte offset pointer to the tail section where the actual data lives.

```typescript
get calldataHeadSize(): number {
  return this.isDynamicallyEncoded ? 32 : this.calldataEncodedSize;
}
```

This directly mirrors `Type::calldataHeadSize()` from Types.h:256.

### Per-Type Size Summary

| Type | exactBits | calldataEncodedSize | calldataHeadSize | isDynamic? |
|------|-----------|--------------------|--------------------|------------|
| `bool` | 1 | 32 | 32 | No |
| `uint8` | 8 | 32 | 32 | No |
| `uint256` | 256 | 32 | 32 | No |
| `address` | 160 | 32 | 32 | No |
| `bytes4` | 32 | 32 | 32 | No |
| `bytes32` | 256 | 32 | 32 | No |
| `uint256[3]` | 768 | 96 | 96 | No |
| `uint256[]` | undefined | throws | 32 | Yes (sized + encoded) |
| `bytes` | undefined | throws | 32 | Yes (sized + encoded) |
| `string` | undefined | throws | 32 | Yes (sized + encoded) |
| Struct (all static) | sum of members | sum of members × 32 | sum of members × 32 | No |
| Struct (has dynamic) | undefined | throws | 32 | Yes (encoded only) |

## Value Types (src/ast/value/)

All value types share these properties (from `ValueType` base class):
- `isValueType = true`
- `calldataEncodedSize = 32` — always padded to one word in calldata
- `isDynamicallyEncoded = false` — always inline, never needs tail
- `isDynamicallySized = false` — size always known at compile time
- `calldataEncodedTailSize` → throws (no tail for value types)

### IntegerType
Maps to `IntegerType` in Types.h:483.

| Property | Value |
|----------|-------|
| `exactBits` | 8, 16, 24, ... 256 |
| `signed` | `boolean` |
| `leftAligned` | `false` (right-aligned, padded with leading zeros) |
| `canonicalName` | `"uint8"`, `"int256"`, etc. |
| `min()` / `max()` | Computable min/max for the bit width and signedness |

### BoolType
Maps to `BoolType` in Types.h:720.

| Property | Value |
|----------|-------|
| `exactBits` | 1 |
| `leftAligned` | `false` |
| `canonicalName` | `"bool"` |
| `min()` / `max()` | 0 / 1 |

### AddressType
Maps to `AddressType` in Types.h:443.

| Property | Value |
|----------|-------|
| `exactBits` | 160 |
| `payable` | `boolean` |
| `leftAligned` | `false` (right-aligned — 12 zero bytes then 20 address bytes) |
| `canonicalName` | `"address"` or `"address payable"` |

### ContractType
Extends `AddressType`. Contract references encode identically to addresses in ABI encoding.
The `name` field preserves the contract name for source-level references.

### FixedBytesType
Maps to `FixedBytesType` in Types.h:686.

| Property | Value |
|----------|-------|
| `size` | 1–32 (bytes) |
| `exactBits` | `size * 8` |
| `leftAligned` | `false` in abi-lity's model |
| `canonicalName` | `"byte"` (size=1) or `"bytes1"` ... `"bytes32"` |

> **Note on alignment:** In solc's C++ type system, `FixedBytesType::leftAligned()` returns
> `true` — bytesN values are padded on the right with trailing zeros. abi-lity currently
> has `leftAligned = false` on this type; the alignment distinction is handled elsewhere
> in codegen.

### EnumType
Maps to `EnumType` in Types.h:1094.

| Property | Value |
|----------|-------|
| `name` | Enum name (e.g., `"OrderType"`) |
| `members` | Array of member names |
| `exactBits` | `ceil(log2(members.length))` |
| `encodingType` | `IntegerType(8, false)` — always `uint8` |
| `min()` / `max()` | 0 / `members.length - 1` |

In ABI encoding, enums are encoded as their underlying integer type. Solc uses the smallest
uint that fits, but since enums are capped at 256 members, it's always `uint8`.

### FunctionType
Maps to `FunctionType` in Types.h:1253. Represents external function signatures (not to be
confused with `FunctionTypeName` in solc-typed-ast which represents function type syntax).

| Property | Value |
|----------|-------|
| `exactBits` | 192 (24 bytes = 20 address + 4 selector) |
| `name` | Function name |
| `parameters` | `TupleType` of parameter types |
| `returnParameters` | `TupleType` of return types |
| `visibility` | `FunctionVisibility` enum |
| `stateMutability` | `FunctionStateMutability` enum |
| `functionSelector` | First 4 bytes of keccak256(signature) |

### EventType
Represents Solidity event definitions. Not a solc encoding type per se (events have their
own log-based encoding), but modeled here for signature computation.

| Property | Value |
|----------|-------|
| `name` | Event name |
| `parameters` | `TupleType` of parameter types |
| `indexedParameters` | Subset with `isIndexed = true` |
| `unindexedParameters` | Subset with `isIndexed = false` |
| `anonymous` | Whether the event is anonymous |
| `topic0` | `keccak256(signature)` for non-anonymous events, `undefined` for anonymous |
| `eventSelector` | Full keccak256 hash of the event signature |

### ErrorType
Represents Solidity custom error definitions. Similar structure to events.

| Property | Value |
|----------|-------|
| `name` | Error name |
| `parameters` | `TupleType` of parameter types |
| `errorSelector` | First 4 bytes of keccak256(signature) |

### UserDefinedValueType
Maps to `UserDefinedValueType` in solc. Delegates all encoding properties to its underlying type.

```typescript
get exactBits() { return this.underlyingType.exactBits; }
get leftAligned() { return this.underlyingType.leftAligned; }
get encodingType() { return this.underlyingType; }
```

## Reference Types (src/ast/reference/)

### ArrayType
Maps to `ArrayType` in Types.h:835. Represents both fixed-size (`T[N]`) and dynamic (`T[]`) arrays.

| Property | Fixed (`T[N]`) | Dynamic (`T[]`) |
|----------|---------------|-----------------|
| `length` | `N` | `undefined` |
| `isDynamicallySized` | `false` | `true` |
| `isDynamicallyEncoded` | Only if base is dynamic | `true` |
| `calldataEncodedSize` | `N * calldataStride` | throws |
| `calldataEncodedTailSize` | N/A (not dynamic) or the encoded size | 32 (just the length) |
| `calldataStride` | `baseType.calldataHeadSize` | `baseType.calldataHeadSize` |
| `memoryStride` | `baseType.memoryHeadSize` (always 32) | same |

`calldataStride` is the distance between consecutive elements in calldata. For static base
types this equals `calldataEncodedSize` of the base; for dynamic base types it's 32 (the
offset pointer size). This maps to solc's `Type::calldataStride()`.

### TupleLikeType / TupleType / StructType

`TupleLikeType` is the shared base for both `TupleType` and `StructType`. It implements:
- `isDynamicallyEncoded`: `true` if any child is dynamically encoded
- `calldataEncodedSize`: Sum of children's `calldataEncodedSize` (throws if dynamic)
- `calldataEncodedTailSize`: Sum of children's `calldataHeadSize`

**TupleType** (`ABITypeKind.Tuple`): Represents function parameter/return lists.
- `getParamNames(base)`: Returns member names, using `base<index>` for unnamed members
- Unnamed in ABI — serialized as `(type1,type2,...)`

**StructType** (`ABITypeKind.Struct`): Represents named struct definitions.
- `name`: Struct name (e.g., `"OrderComponents"`)
- `canonicalNameOverride`: Optional override for the ABI canonical name
- `writeDefinition()`: Generates Solidity `struct Name { ... }` source

### BytesType / StringType
Represent the `bytes` and `string` types — dynamically-sized packed byte arrays.

| Property | Value |
|----------|-------|
| `isDynamicallySized` | `true` |
| `isDynamicallyEncoded` | `true` |
| `exactBits` | `undefined` |
| `calldataEncodedTailSize` | 32 (the length field) |

`StringType` extends `BytesType` with `isBytes = false`. They encode identically in ABI.

## Offset Calculation

The `TypeNodeWithChildren` class provides three offset calculation methods, each computing
the byte (or bit) position of a child member within its parent:

### `calldataOffsetOfChild(child)`
Sums `calldataHeadSize` of all preceding siblings. This is the ABI head-section offset.

```
Struct { uint256 a; bytes b; uint256 c; }
         offset 0    offset 32  offset 64
         (value)     (ptr→tail) (value)
```

### `memoryOffsetOfChild(child)`
Sums `memoryHeadSize` (always 32) of all preceding siblings. Memory layout uses 32-byte
slots for everything, even pointers to dynamic data.

### `exactBitsOffsetOfChild(child)`
Computes the bit-level offset for packed/storage layouts. This is the most complex method
because it handles the word-boundary padding rule:

```typescript
// For fields that can be read as a single word, pad the end of the previous
// field if it ends mid-byte and the additional bits would make it impossible
// to read the current field in one word.
if (size <= 256 && size + (offset % 8) > 256) {
  offset += 8 - (offset % 8);
}
```

**What this does:** If a field is small enough to fit in one 256-bit word, but the current
bit offset would cause it to straddle a word boundary, pad the offset forward to the next
byte boundary. This ensures each small field can be loaded with a single `mload`/`sload`.

**Example:** A struct `{ uint200 a; uint200 b; }`:
- `a` at offset 0, size 200 bits
- Without padding: `b` would start at bit 200, spanning bits 200-399 (crosses the 256-bit boundary)
- With padding: `b` starts at bit 256 (next word boundary), readable in one word

## Visitor Pattern

`TypeNodeVisitor` (src/ast/type_node_visitor.ts) provides a type-safe visitor over the TypeNode
hierarchy. The `DefaultVisitor` class dispatches based on `ABITypeKind`:

```typescript
class MyVisitor extends DefaultVisitor {
  visitInteger(type: IntegerType) { /* ... */ }
  visitStruct(type: StructType) { /* ... */ }
  visitArray(type: ArrayType) { /* ... */ }
  // etc.
}
```

The visitor resolves method names dynamically: `kind` → PascalCase → `visit${PascalCase}`.
Unmatched value types fall through to `visitValueType()`, unmatched reference types to
`visitUnmatchedReferenceType()`.

## Union Types and Type Guards

The module exports discriminated union types and type guard functions:

```typescript
// All concrete value types
type UValueType = AddressType | BoolType | ContractType | EnumType | ...;
const isUValueType = (type: TypeNode): type is UValueType;

// All concrete reference types
type UReferenceType = ArrayType | BytesType | StringType | StructType | TupleType;

// All ABI-encodable types
type UABIType = UReferenceType | UValueType;
const isUABIType = (type: TypeNode): type is UABIType;
```

`PossibleValueTypes` and `PossibleReferenceTypes` are arrays of the concrete class
constructors, used with `isInstanceOf()` for runtime type checking.

## How Types Map to solc

Cross-reference table between abi-lity TypeNodes and solc's C++ types in
`/root/d1ll0n/new-solidity/libsolidity/ast/Types.h`:

| abi-lity TypeNode | solc C++ Class | Types.h Line |
|-------------------|---------------|--------------|
| `IntegerType` | `IntegerType` | 483 |
| `BoolType` | `BoolType` | 720 |
| `AddressType` | `AddressType` | 443 |
| `FixedBytesType` | `FixedBytesType` | 686 |
| `EnumType` | `EnumType` | 1094 |
| `ArrayType` | `ArrayType` | 835 |
| `StructType` | `StructType` | 1029 |
| `FunctionType` | `FunctionType` | 1253 |
| `BytesType` / `StringType` | `ArrayType` (kind=Bytes/String) | 835 |
| `TupleType` | `TupleType` | 1217 |
| `UserDefinedValueType` | `UserDefinedValueType` | — |
| `ContractType` | `ContractType` | 1170 |
