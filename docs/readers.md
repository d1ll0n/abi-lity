# abi-lity Readers Module

The `src/readers/` module converts external Solidity type representations into abi-lity's
internal `TypeNode` tree. There are three input paths — all produce the same
`TypeNodeReaderResult` output.

## Three Input Paths

```
                    ┌────────────────────┐
                    │ TypeNodeReaderResult│
                    │  .functions         │
                    │  .structs           │
                    │  .events            │
                    │  .errors            │
                    │  .enums             │
                    │  .context           │
                    └────────┬───────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
    ┌─────────┴──┐  ┌───────┴────┐  ┌──────┴──────┐
    │ solc AST   │  │ JSON ABI   │  │ Solidity    │
    │ (compiled) │  │ (ethers)   │  │ (source)    │
    └────────────┘  └────────────┘  └─────────────┘
```

### Path 1: Compiled solc AST (`read_solc_ast.ts`)

**Entry points:** `readTypeNodesFromSolcAST()`, `readTypeNodesFromContractInterface()`

**When to use:** You have already compiled Solidity with solc and have the typed AST
(via `solc-typed-ast`'s `ASTReader`). This is the most common path — it has access to
the compiler's full type inference, so it handles all edge cases (constant expressions
in array sizes, inherited types, user-defined value types, etc.).

**How it works:**
1. Takes `SourceUnit[]` from solc-typed-ast
2. Uses `ASTSearch` to find all definition nodes (functions, structs, events, errors, enums)
3. Converts each definition via `*DefinitionToTypeNode()` functions
4. Each converter calls `typeNameToTypeNode()` or `solcTypeNodeToTypeNode()` to recursively
   build the TypeNode tree

**`readTypeNodesFromContractInterface()`** is the specialized variant that only extracts
public/external functions and additionally discovers events and errors that are emitted or
reverted at runtime (via `getEmitsByEvent()` / `getRevertsByError()` from codegen).

### Path 2: JSON ABI (`read_abi.ts`)

**Entry point:** `readTypeNodesFromABI()`

**When to use:** You have a JSON ABI (e.g., from etherscan, a compiled artifact, or an
interface file). No source code or compiler needed.

**How it works:**
1. Parses `JsonFragment[]` using ethers v5's `Interface` class
2. Iterates functions, errors, and events from the parsed interface
3. Recursively converts `ParamType` trees to TypeNodes via `fromParamType()`
4. The `InterfaceTypes` class collects nested structs and enums discovered during
   recursive traversal (struct parameters inside functions, etc.)

**Limitations:**
- Enum member names are not available in ABI JSON — creates placeholder members
- No access to NatSpec documentation
- `internalType` field is used heuristically to detect struct names and enum types

### Path 3: Raw Solidity source (`read_code.ts`)

**Entry point:** `readTypeNodesFromSolidity()`

**When to use:** You have raw Solidity text and want to extract types without invoking
the compiler. Useful for quick parsing or when the compiler is unavailable.

**How it works:**
1. Parses source text with `@solidity-parser/parser`
2. Visits the AST to collect all type-defining nodes (structs, enums, functions, etc.)
3. Topologically sorts definitions so types are resolved before their dependents
4. Converts each definition via the `ParserTypes` class

**Special features:**
- Public state variables are automatically synthesized into getter `FunctionType` nodes
  (including mapping key unwinding)
- Functions are deduplicated by selector, with internal-visibility duplicates stored
  under their internal signature
- Handles `type X is Y` definitions (Solidity user-defined value types)

**Limitations:**
- Cannot evaluate complex constant expressions for array sizes (only number literals)
- `allowUndefinedUserTypes` flag creates placeholder `EnumType` for unresolved references
- No access to inherited types from base contracts

## The Core Conversion: `solcTypeNodeToTypeNode()`

The most important function in the module. Maps solc-typed-ast's inferred types to
abi-lity TypeNodes:

| solc-typed-ast Type | abi-lity TypeNode | Notes |
|---------------------|-------------------|-------|
| `SolcBoolType` | `BoolType` | Direct |
| `SolcAddressType` | `AddressType` | Preserves `payable` |
| `SolcIntType` | `IntegerType` | Uses `nBits`, `signed` |
| `SolcFixedBytesType` | `FixedBytesType` | Uses `size` |
| `SolcStringType` / `SolcStringLiteralType` | `StringType` | Direct |
| `SolcBytesType` | `BytesType` | Direct |
| `SolcArrayType` | `ArrayType` | Recursive (converts `elementT`), `size` for fixed |
| `SolcTupleType` | `TupleType` | Recursive (converts all `elements`) |
| `SolcFunctionType` | `FunctionType` | Full mapping: name, params, returns, visibility, mutability |
| `SolcErrorType` | `ErrorType` | Name + parameter tuple |
| `SolcEventType` | `EventType` | Name + parameter tuple |
| `SolcUserDefinedType` | Struct / Enum / Contract | Dispatches based on `definition` type |
| `SolcPointerType` | (unwraps to inner) | Dereferences `to` — data location is discarded |
| `SolcIntLiteralType` | (smallest fitting int) | Uses `smallestFittingType()` |
| `SolcNumericLiteralType` / `SolcU256Type` | `IntegerType(256, false)` | Defaults to uint256 |
| `SolcTypeNameType` | (unwraps to inner) | Recursive — unwraps `type` |

Unsupported types (`ModifierType`, `BuiltinFunctionType`, `BuiltinStructType`, etc.)
throw an error.

## TypeNodeReaderResult

All three paths return the same output type:

```typescript
type TypeNodeReaderResult = {
  context: ASTContext;      // Node registry for ID-based lookup
  functions: FunctionType[];
  structs: StructType[];
  events: EventType[];
  errors: ErrorType[];
  enums: EnumType[];
};
```

All returned TypeNodes are registered in the shared `context`, enabling cross-references
and lookup by ID.

## Shared Utility: `elementaryTypeStringToTypeNode()`

Used by both `read_abi.ts` and `read_code.ts` to parse elementary type name strings:

```
"bool"           → BoolType
"address"        → AddressType
"address payable"→ AddressType(payable=true)
"uint256"        → IntegerType(256, false)
"int8"           → IntegerType(8, true)
"int"            → IntegerType(256, true)     // no width → defaults to 256
"bytes32"        → FixedBytesType(32)
"byte"           → FixedBytesType(1)
"bytes"          → BytesType
"string"         → StringType
```

## File Overview

| File | Lines | Purpose |
|------|-------|---------|
| `read_solc_ast.ts` | 484 | Core bridge: solc-typed-ast → TypeNodes |
| `read_code.ts` | 524 | Raw Solidity source parser (uses `@solidity-parser/parser`) |
| `read_abi.ts` | 213 | JSON ABI parser (uses ethers v5 `Interface`) |
| `elementary.ts` | 58 | Elementary type string → TypeNode converter |
| `types.ts` | 10 | `TypeNodeReaderResult` type definition |
| `index.ts` | 487 | Barrel re-exports (+ unrelated test/analysis code) |
| `read_type_string.ts` | 15 | Dead code (entirely commented out) |
