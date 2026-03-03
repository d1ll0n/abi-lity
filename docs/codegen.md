# Codegen Module — `src/codegen/`

The output layer of abi-lity. Takes TypeNode trees (from the type system) and generates optimized
Solidity code that replaces standard ABI encoding/decoding with type-specialized alternatives.

## Architecture: Two Code Generation Approaches

The codegen module contains two parallel code generation layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                     codegen/generate.ts                         │
│            (re-exports from coders/generate.ts)                 │
├─────────────────────────┬───────────────────────────────────────┤
│   Text-based Layer      │   AST-based Layer                    │
│   (StructuredText)      │   (solc-typed-ast mutations)         │
│                         │                                       │
│  codegen/abi_decode/    │  codegen/coders/abi_decode/           │
│  codegen/abi_encode/    │  codegen/coders/abi_encode/           │
│                         │  codegen/coders/generate.ts           │
│  Uses CodegenContext    │  Uses WrappedScope                    │
│  Batch → CompileHelper  │  Direct AST manipulation              │
│  addFunctionCode()      │  addFunctionMutation()               │
└─────────────────────────┴───────────────────────────────────────┘
```

### Text-based (`CodegenContext`)

Generates `StructuredText` code strings (nested arrays of strings representing indented code).
Functions are queued as pending additions, then compiled into AST nodes via
`CompileHelper.addFunctionCode()`. Located in `codegen/abi_decode/` and `codegen/abi_encode/`.

### AST-based (`WrappedScope`)

Directly manipulates the solc-typed-ast AST tree. Functions are added via
`CompileHelper.addFunctionMutation()`, which parses code and inserts AST nodes at the
specified scope. Uses the visitor pattern for type-dispatched code generation. Located in
`codegen/coders/abi_decode/` and `codegen/coders/abi_encode/`.

The AST-based approach is the primary/active layer. The text-based approach is retained for
standalone decoder file generation.

## Pipeline Flow

```
upgradeSourceCoders()               ← Main entry point (coders/generate.ts)
  │
  ├── Collect external functions with reference type parameters
  ├── Collect return statements, emit calls, revert calls
  ├── Collect hash calls and abi.encode calls
  │
  ├── buildDecoderFile()             ← ABI decoding (coders/abi_decode/)
  │     Uses AbiDecodeVisitor to generate type-specialized decoders
  │
  ├── createReturnFunction()         ← Return encoding (coders/abi_encode/)
  ├── createEmitFunction()           ← Event encoding
  ├── createRevertFunction()         ← Error encoding
  ├── createHashFunction()           ← keccak256 encoding
  ├── createAbiEncodingFunction()    ← General abi.encode replacement
  │     All use AbiEncodeVisitor for type-specialized encoders
  │
  ├── renamePublicStateVariables()   ← State variable getters (coders/state_variables.ts)
  │
  └── getFunctionSelectorSwitch()    ← Selector dispatch (coders/function_switch.ts)
        Generates fallback function with if/else selector matching
```

## Subsystem Map

```
src/codegen/
├── index.ts                  Re-exports abi_decode, abi_encode, generate
├── generate.ts               Re-exports upgradeSourceCoders from coders/
├── utils.ts                  CodegenContext, ContractCodegenContext, utility functions
├── names.ts                  NameGen — naming conventions for generated identifiers
├── offsets.ts                Struct member offset computation helpers
├── wrappers.ts               External wrapper contract generation
│
├── ctx/
│   └── contract_wrapper.ts   WrappedScope, WrappedSourceUnit, WrappedContract
│
├── abi_decode/               Text-based ABI decoding (StructuredText approach)
│   ├── abi_decode.ts           Main decoder dispatcher (struct/bytes/array routing)
│   ├── abi_decode_array.ts     Four array decoding strategies
│   ├── generate.ts             buildDecoderFile() — complete decoder source unit
│   ├── function_editor.ts      External function parameter replacement
│   └── type_cast.ts            Function pointer casting between signatures
│
├── abi_encode/               Text-based ABI encoding (StructuredText approach)
│   ├── abi_encode.ts           Struct/bytes/tuple/parameter encoding
│   ├── abi_encode_array.ts     Three array encoding strategies
│   ├── function_editor.ts      Return statement replacement
│   └── type_cast.ts            Adaptor function generation
│
├── coders/                   AST-based code generation (primary approach)
│   ├── generate.ts             upgradeSourceCoders() — main orchestration
│   ├── function_switch.ts      Selector dispatch / fallback generation
│   ├── state_variables.ts      Public state variable getter generation
│   │
│   ├── abi_decode/             AST-based decoding
│   │   ├── abi_decode.ts         AbiDecodeVisitor — type-dispatched decoders
│   │   ├── generate.ts           buildDecoderFile() (WrappedScope version)
│   │   ├── function_editor.ts    Parameter replacement
│   │   └── type_cast.ts          Signature casting
│   │
│   ├── abi_encode/             AST-based encoding
│   │   ├── abi_encode_visitor.ts AbiEncodeVisitor — type-dispatched encoders
│   │   ├── create_return.ts      Return encoding
│   │   ├── create_emit.ts        Event encoding
│   │   ├── create_revert.ts      Error encoding
│   │   ├── create_hash.ts        Hash encoding
│   │   ├── create_abi_encode.ts  General abi.encode replacement
│   │   └── type_cast.ts          Adaptor generation
│   │
│   ├── storage_cache/          Storage slot caching + accessor code generation
│   │   ├── get_slots.ts          StorageCacheLibraryGenerator — cache/update functions
│   │   ├── pack-stacker.ts       PackedStackTypeGenerator — 256-bit stack packing
│   │   ├── packed-memory-struct.ts PackedMemoryTypeGenerator — memory layout optimization
│   │   ├── generare-type-libraries.ts  Type library generation for packed types
│   │   └── accessors/            Field-level read/write accessor generation
│   │       ├── read_memory.ts      Memory read accessors
│   │       ├── write_memory.ts     Memory write accessors
│   │       ├── read_stack.ts       Stack read accessors
│   │       ├── write_stack.ts      Stack write accessors
│   │       ├── pack_word.ts        Word packing utilities
│   │       ├── types.ts            Accessor type definitions
│   │       └── utils.ts            Yul/assembly utilities
│   │
│   ├── stack-packer/           Stack value packing
│   │   └── encode.ts
│   │
│   └── templates/              Template function definitions
│       └── templates.ts
│
├── type_libraries/           Runtime type library generation
│   ├── generate.ts             buildPointerFiles() — pointer library index
│   ├── type_builder_library.ts Fluent builder pattern for runtime type construction
│   ├── generate_fuzzer.ts      FuzzGenerator — visitor-based fuzzer generation
│   └── type_libs.ts            Pointer cast function generation
│
├── solidity_libraries/       Bundled Solidity library code (JSON → SourceUnit)
│   ├── index.ts                SolidityLibraries map and getters
│   └── build_structured_text.ts JSON-to-StructuredText builder
│
├── serialize/                JSON serialization code generation
│   ├── to_string.ts            Forge-compatible serialize functions
│   └── forge_json.ts           JSON serialization variant
│
├── data-table/               Memory layout constants
│   └── solidity_memory_layout.ts
│
└── test-shim/                Test harness generation
    └── generate.ts             generateForgeTestShim()
```

## Key Classes

### `CodegenContext` (`utils.ts`)

Text-based code generation context. Manages a decoder source unit, batches pending function
additions as `StructuredText`, and compiles them via `CompileHelper.addFunctionCode()`.
Provides helpers for constants, imports, pointer libraries, and contract creation.

### `WrappedScope` / `WrappedSourceUnit` / `WrappedContract` (`ctx/contract_wrapper.ts`)

AST-based code generation scope wrappers. Directly manipulate the solc-typed-ast AST tree
via `CompileHelper.addFunctionMutation()`. Cached via WeakMaps (`SOURCE_UNIT_WRAPPERS`,
`CONTRACT_WRAPPERS`) for singleton access per AST node.

### `NameGen` (`names.ts`)

Centralized naming conventions object. Ensures all generated identifiers (decode/encode
functions, constants, type libraries, selectors) follow consistent naming patterns.

### `AbiDecodeVisitor` / `AbiEncodeVisitor` (`coders/abi_decode/`, `coders/abi_encode/`)

TypeNode visitors that generate type-specialized decoding/encoding code by dispatching
on type kind (struct, array, bytes, value type, tuple).

## Relationship to Other Modules

```
src/readers/  ──→  src/ast/  ──→  src/codegen/
   (input)        (TypeNodes)      (output)
```

- **ast module**: Codegen reads TypeNode trees to determine encoding metadata (sizes, offsets,
  dynamic types). The TypeNode `identifier` is used as the key for function naming via `NameGen`.
- **readers module**: Readers produce TypeNodes from Solidity source. Codegen consumes them.
  The `CompileHelper` (from utils) is shared — readers use it to parse, codegen uses it to
  emit new code into the same compilation context.

## Encoding Strategies

### Array Decoding (4 strategies)
1. **Value array**: Simple `calldatacopy` for arrays of value types
2. **Combined static tail**: Fixed-size reference type elements with predictable tail offsets
3. **Combined dynamic tail**: Dynamic elements where each tail size must be computed
4. **Separate tail**: Arrays with deeply nested reference types requiring per-element decoding

### Array Encoding (3 strategies)
1. **Value array**: Direct `mcopy` for value type arrays
2. **Combined static tail**: Reference arrays with fixed tail sizes
3. **Separate tail**: Complex types requiring per-element encoding with pointer fixups
