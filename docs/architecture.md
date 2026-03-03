# abi-lity Architecture

## What abi-lity Does

abi-lity is a Solidity code generation toolkit that replaces the standard ABI encoding/decoding
routines produced by solc with optimized, type-specialized alternatives. Where solc's `ABIFunctions.cpp`
generates generic Yul functions at compile time, abi-lity works at the Solidity source level — it
reads contract definitions, builds a rich type model, and emits new Solidity code (with inline
assembly) that performs the same encoding/decoding with less gas.

### How It Differs From solc's ABIFunctions

| | solc (ABIFunctions.cpp) | abi-lity |
|---|---|---|
| **Output** | Yul code strings | Solidity + inline assembly |
| **When** | During Yul IR generation | Before compilation (source-to-source) |
| **Strategy** | Generic functions per type signature | Type-specialized code with precomputed offsets |
| **Memory** | Allocates and copies (decoder) | Works with pointers directly |
| **Offsets** | Runtime head/tail pointer arithmetic | Constants computed at generation time |

See `notes/solc-abi-encoding.md` for a detailed breakdown of ABIFunctions.cpp.

## Module Map

```
src/
├── ast/              TypeNode type system (this doc's primary focus)
│   ├── node.ts           Base tree node with traversal
│   ├── type_node.ts      TypeNode + TypeNodeWithChildren (encoding metadata)
│   ├── type_node_visitor.ts  Visitor pattern over TypeNode trees
│   ├── ast_context.ts    Node registry / ID→node lookup
│   ├── type_provider.ts  Factory shortcuts (e.g. TypeProvider.uint(256))
│   ├── value/            Value types: bool, int, address, bytes1-32, enum, ...
│   └── reference/        Reference types: array, struct, tuple, bytes, string
│
├── readers/          Input layer — parses Solidity / JSON ABI / solc AST → TypeNodes
│   ├── read_solc_ast.ts      solc-typed-ast InferType → abi-lity TypeNodes
│   ├── read_abi.ts           JSON ABI → TypeNodes
│   └── read_solidity.ts      Compile + read pipeline
│
├── codegen/          Code generation engine (largest module)
│   ├── coders/           Primary implementation
│   │   ├── abi_decode/       Calldata/returndata decoding codegen
│   │   ├── abi_encode/       Calldata/returndata encoding codegen
│   │   ├── storage_cache/    Storage slot caching + accessor codegen
│   │   └── stack-packer/     Stack value packing
│   ├── type_libraries/   Runtime type library generation
│   ├── ctx/              Code generation context (ContractWrapper)
│   ├── names.ts          Naming conventions for generated identifiers
│   └── offsets.ts        Memory/calldata offset calculations
│
├── analysis/         Static analysis utilities
│   ├── struct_member_access.ts  Struct field access analysis
│   ├── storage_positions/       Storage layout computation
│   └── ir_tracker/              Yul IR tracking
│
├── encoding/         Encoding scheme definitions
│   └── schemes for Solidity memory layout vs ABI encoding vs super-packed
│
├── codec/            Memory codec implementation
│
├── command_line/     CLI commands (yargs-based)
│   └── commands/         codegen, inspection, and test subcommands
│
├── utils/            Shared utilities
│   ├── compile_helper.ts    Solc compilation wrapper
│   ├── solc.ts              Compiler version management
│   └── text/, files/, etc.  String formatting, file I/O
│
├── test_utils/       Test harness utilities
│
├── constants.ts      ABITypeKind, EncodingScheme, DataLocation enums
├── index.ts          Main entry point (re-exports ast, utils, constants, codegen, readers)
└── cli.ts            CLI entry point (yargs command dispatch)
```

## Data Flow

The core pipeline is a three-stage transformation:

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Input Sources   │     │   Type System    │     │  Code Generation │
│                  │     │                  │     │                  │
│ Solidity source  │────▶│  TypeNode tree   │────▶│  Optimized       │
│ JSON ABI         │     │  (src/ast/)      │     │  Solidity code   │
│ solc AST JSON    │     │                  │     │  (src/codegen/)  │
│                  │     │                  │     │                  │
│ (src/readers/)   │     │                  │     │                  │
└─────────────────┘     └──────────────────┘     └──────────────────┘
```

### Stage 1: Reading (src/readers/)

The readers module converts various input formats into abi-lity's internal TypeNode representation.
The most common path is:

1. **Compile** Solidity source with solc via `CompileHelper` (wraps `compileSync()` from `@d1ll0n/solc-typed-ast`)
2. **Parse** the compiler output into solc-typed-ast nodes (`ASTReader.read()`)
3. **Infer types** using solc-typed-ast's `InferType` to get semantic type information
4. **Convert** solc type nodes to abi-lity TypeNodes:
   - `SolcIntType` → `IntegerType`
   - `SolcFixedBytesType` → `FixedBytesType`
   - `SolcArrayType` → `ArrayType`
   - `SolcUserDefinedType` (struct) → `StructType`
   - etc.

The key translation file is `readers/read_solc_ast.ts`. It bridges the gap between
solc-typed-ast's type system (which mirrors solc's C++ `Type` hierarchy from `Types.h`) and
abi-lity's TypeNode system (which carries encoding-specific metadata needed for codegen).

### Stage 2: Type System (src/ast/)

The TypeNode hierarchy is abi-lity's central data structure. Each TypeNode carries:

- **Identity**: `kind`, `canonicalName`, `identifier`
- **Classification**: `isValueType`, `isDynamicallyEncoded`, `isDynamicallySized`
- **Size metadata**: `exactBits`, `calldataEncodedSize`, `calldataHeadSize`, `memoryHeadSize`
- **Alignment**: `leftAligned` (true only for `bytes1`-`bytes32`)
- **Tree structure**: `parent`, `children`, offset calculations for child members

This is where encoding decisions that solc makes at Yul codegen time are instead computed
upfront as properties of the type tree. See `docs/type-system.md` for the full guide.

### Stage 3: Code Generation (src/codegen/)

The codegen module walks TypeNode trees and emits optimized Solidity code. Key subsystems:

- **ABI Decode** (`codegen/coders/abi_decode/`): Generates calldata decoding functions that
  read directly from calldata pointers without memory allocation
- **ABI Encode** (`codegen/coders/abi_encode/`): Generates encoding functions with precomputed
  offsets instead of runtime head/tail pointer arithmetic
- **Storage Cache** (`codegen/coders/storage_cache/`): Generates storage accessor libraries
  that cache slot values to avoid redundant SLOADs
- **Type Libraries** (`codegen/type_libraries/`): Generates per-type Solidity libraries with
  helper functions

## Key External Dependencies

### solc-typed-ast (`@d1ll0n/solc-typed-ast`)

A forked version of Consensys's `solc-typed-ast` library. Provides:
- Solidity compilation (`compileSync()`)
- Typed AST representation (all solc AST node types)
- Type inference (`InferType`)
- AST construction (`ASTNodeFactory`) and writing (`ASTWriter`)

abi-lity uses this as its foundation for reading and understanding Solidity code.
See `notes/solc-typed-ast.md` for focused notes on the fork.

### solc (C++ compiler)

Not a runtime dependency, but abi-lity's type system is designed to mirror solc's internal
`Type` hierarchy from `libsolidity/ast/Types.h`. The encoding metadata on TypeNode
(`calldataEncodedSize`, `calldataHeadSize`, `isDynamicallyEncoded`, etc.) maps directly to
virtual methods on solc's `Type` base class. This ensures that abi-lity's generated code
produces the same ABI encoding as solc.

Cross-reference: `/root/d1ll0n/new-solidity/libsolidity/ast/Types.h`
