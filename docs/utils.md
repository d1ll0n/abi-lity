# Utils Module (`src/utils/`)

Shared utilities used across the abi-lity toolkit — by the AST layer, readers, and codegen.

## Module Map

```
src/utils/
├── index.ts                    Barrel re-exports
│
│  ── Core Helpers ──
├── array.ts                    Collection utilities (last, range, sum)
├── bytes.ts                    Hex/bitmask arithmetic for EVM word packing
├── text.ts                     StructuredText — nested-array code generation
├── loggers.ts                  Logger interface + terminal status line
├── defaults.ts                 Deterministic default values for any TypeNode
├── type_extractor.ts           Collects unique reference types for coder gen
│
│  ── Solc AST Manipulation ──
├── solc_ast_utils.ts           ~48 helpers for querying/building solc-typed-ast nodes
├── builders.ts                 AST node factory shortcuts
├── builtins.ts                 Solidity built-in function detection
├── make_constant.ts            File-level constant variable generation
├── references.ts               Cross-reference resolution and import management
├── invocations.ts              Function/event/error call-site construction
│
│  ── Compilation Pipeline ──
├── compile_helper.ts           Legacy CompileHelper (666 lines, deprecated)
├── compile_utils/
│   ├── compile_helper.ts       Current CompileHelper — wraps solc compilation
│   ├── mutations.ts            AST mutation queue (add/remove/replace nodes)
│   └── solc.ts                 Low-level solc invocation and I/O
│
│  ── Files & Paths ──
├── files/
│   ├── index.ts                Barrel re-exports
│   ├── path_utils.ts           getDirectory, getRelativePath, isExternalFunction, etc.
│   ├── cache.ts                Simple file-system cache
│   └── forge_remappings.ts     Foundry import remapping resolution
│
│  ── Misc ──
├── source_editor.ts            Line-level source text manipulation
├── optimizer.ts                AST-to-AST optimization transforms
├── regex.ts                    Solidity function/type signature parsing via regex
├── event-emitter.ts            Typed event emitter
└── hljs/
    ├── index.ts                Yul + Solidity syntax highlighting
    └── theme.ts                CLI color theme
```

## Key Concepts

### StructuredText (`text.ts`)

The universal code-output format. A recursive type where array nesting equals
indentation depth:

```ts
type StructuredText<T = string> = Array<StructuredText<T>> | T[] | T;

// Example:
const code: StructuredText = [
  "function foo() {",
  ["uint256 x = 1;", "return x;"],  // indented one level
  "}"
];
writeNestedStructure(code);
// "function foo() {\n  uint256 x = 1;\n  return x;\n}"
```

Helper families: `prefix/suffix/set + First/Last + String`, `searchAndReplace`,
`wrap/wrapParentheses/wrapBraces/wrapBrackets`, `addCommaSeparators`.

### Byte/Mask Arithmetic (`bytes.ts`)

Generates EVM-word bitmasks for packed storage access:
- `getOmissionMask(size, offset)` — zeros out a field (AND mask)
- `getInclusionMask(bits, offset)` — isolates a field
- `maxUint(bits)` — max value for a bit width
- `toHex(n)` — auto-checksums 20-byte values as addresses

### CompileHelper (`compile_utils/compile_helper.ts`)

Wraps the Solidity compiler with AST access:
1. Accepts source files (paths or in-memory maps)
2. Compiles via solc with configurable settings
3. Provides `getSourceUnit(name)` for AST access
4. Integrates with `mutations.ts` for AST transforms

The legacy `compile_helper.ts` (root level) is a predecessor with a similar API
but should not be used for new code.

### Solc AST Utilities (`solc_ast_utils.ts`)

The largest file (~840 lines, ~48 exports). Provides helpers for:
- **Querying**: `getParentSourceUnit()`, `getParentContract()`, `isExternalFunction()`, etc.
- **Type resolution**: `getTypeNode()`, `typeNodeToTypeString()`
- **Building nodes**: factories for function definitions, parameters, statements
- **Signatures**: `getFunctionSelector()`, function signature formatting

### Type Extractor (`type_extractor.ts`)

Walks TypeNode trees to discover which reference types need ABI coder
generation. Unwraps functions/errors/events/tuples to find nested members.
Separately tracks "function parameters" (types that appear as external function
inputs, needing decoder generation) vs general "types" (all reference types
needing encoder/decoder support).

## Relationship to Other Modules

```
readers ──→ utils (CompileHelper, solc_ast_utils, regex)
ast     ──→ utils (bytes, text, array)
codegen ──→ utils (all of the above + defaults, type_extractor, optimizer)
```

The utils module has no dependencies on ast, readers, or codegen (with the
exception of `bytes.ts` importing `getOffsetYulExpression` from codegen/offsets,
and `defaults.ts` importing TypeNode types from ast).
