# Command Line Module (`src/command_line/`)

## Architecture Overview

The CLI module follows a three-tier structure:

```
commands.ts                          # Top-level aggregator (imports from ./commands/codegen, etc.)
commands/index.ts                    # Near-identical aggregator (imports from ./codegen, etc.)
commands/
  codegen/                           # 8 code generation commands
  inspection/                        # 3 active + 1 dead inspection commands
  test/                              # 3 test-related commands
utils.ts                             # Older CLI utilities (partially superseded)
utils2.ts                            # Newer CLI utilities (updated compiler API)
```

There is no dedicated `cli.ts` entry point. Instead, `commands.ts` at the top
level serves as the entry point. It imports the three command groups and reduces
them onto a yargs instance via `addCommands`. The file `commands/index.ts` is
a near-duplicate that performs the same aggregation but with different relative
import paths (e.g. `./codegen` instead of `./commands/codegen`). See
`notes/dead-code-and-cleanup.md` for cleanup notes.

Each command group directory exports an array of command objects, each with an
`addCommand(yargs)` method that registers the command with yargs.

---

## Command Catalog

### Codegen Commands (`commands/codegen/`)

| Command | File | Description |
|---------|------|-------------|
| `$0 <input> [output]` | `generate_coders.ts` | Default command. Generates ABI decoding library and function switch. |
| `iface <input> [output]` | `iface.ts` | Generates Solidity interface files from `.sol` or `.json`. |
| `wrappers <input> [output]` | `wrappers.ts` | Generates external wrappers for free/library functions. |
| `ptr-libs <input> [output]` | `pointer_libs.ts` | Generates pointer libraries for structs. |
| `rename <input> [output] [search] [replace]` | `rename.ts` | Replaces a word across a Solidity directory. |
| `assert_eq <input> [output]` | `assert_eq/` | Generates Forge equality assertions for Solidity types. |
| `ctype <input> [output]` | `ctype/` | Generates custom type + library for contract interface calls. |
| `forge-json <input> [output]` | `forge_json/` | Generates Forge JSON serializers. |
| `json <input> [output]` | `json/` | Generates JSON serializers for Solidity types. |

### Inspection Commands (`commands/inspection/`)

| Command | File | Status | Description |
|---------|------|--------|-------------|
| `selectors <input> [name] [output]` | `selectors.ts` | Active | Prints function selectors. |
| `size <input>` | `size.ts` | Active | Prints runtime code size. |
| `ir <input> [output]` | `ir.ts` | Active | Compiles and outputs IR/Yul. |
| `abi <input> <output> [name]` | `abi.ts` | Dead | Entirely commented out. |

### Test Commands (`commands/test/`)

| Command | File | Description |
|---------|------|-------------|
| `compare <input>` | `compare.ts` | Compares gas and codesize across implementations. |
| `copy-test <input> [output]` | `copy_test.ts` | Generates and tests copy contracts. |
| `shim <input> [output]` | `shim.ts` | Generates Forge test shims. |

---

## Utility Files

The module contains two utility files that represent a partial migration of the
compiler helper API.

### `utils.ts` (older, ~140 lines)

Exports:

- **`CommandLineInputPaths`** -- Type containing `basePath`, `fileName`, `input`, `output`, and `helper`.
- **`getCommandLineInputPaths()`** -- Resolves CLI input/output paths and creates a `CompileHelper`. Uses the older `CompileHelper.fromFileSystem` signature with positional arguments (`version, fileName, basePath, optimize, optionOverrides`).
- **`renameFile()`** -- Renames a file within a `Map<string, string>` file set, updating the key.
- **`writeCompilerOptions()`** -- Formats compiler settings as `StructuredText`. Accepts the older `CompilerOptions` type.
- **`printCodeSize()`** -- Prints compiled contract runtime code size relative to the 24,577-byte limit.

Used by: `assert_eq`, `forge_json`, `pointer_libs`, `size`.

### `utils2.ts` (newer, ~226 lines)

Exports:

- **`CommandLineInputPaths`** -- Same shape as `utils.ts` version (duplicate type).
- **`getTypesFromCommandLineInputs()`** -- New function. Reads type nodes from `.sol` (via `readTypeNodesFromContractInterface`) or `.json` (via `readTypeNodesFromABI`). Returns parsed types keyed by contract name.
- **`getCommandLineInputPaths()`** -- Updated signature that uses the new `CompileHelper.fromFileSystem` API (options object with `settings` and `outputs`) and accepts an `outputConfig` parameter for `CompilerOutputConfigs`.
- **`renameFile()`** -- Same implementation as `utils.ts`.
- **`writeCompilerOptions()`** -- Accepts the newer `CompilerOpts` type (reads `settings.optimizer` instead of `optimizer` directly).
- **`printCodeSize()`** -- Same implementation as `utils.ts`.

Used by: `generate_coders`, `ctype`, `json`, `ir`, `wrappers`, `compare`, `shim`, `iface`.

This split represents a partial migration. Commands that have been updated to
the newer compiler API use `utils2.ts`; legacy commands still import from
`utils.ts`.

---

## Cross-Module Dependencies

- **`../utils`** -- Both utility files import shared helpers (`getAllFilesInDirectory`, `getCommonBasePath`, `getRelativePath`, `isDirectory`, `writeNestedStructure`, `StructuredText`).
- **`../utils/compile_utils/compile_helper`** -- `utils2.ts` imports `CompileHelper` directly from the compile utilities submodule; `utils.ts` imports it from the barrel `../utils`.
- **`../utils/compile_utils/solc`** -- `utils2.ts` imports `CompilerOptions`, `CompilerOpts`, `CompilerOutputConfigs`, `getCompilerOptionsWithDefaults`, and `UserCompilerOptions`.
- **`../readers`** -- `utils2.ts` imports `readTypeNodesFromABI` and `readTypeNodesFromContractInterface` for type extraction from ABI/AST.
- **`solc-typed-ast`** -- Both files use `LatestCompilerVersion`; `utils2.ts` also uses `ASTSearch` and `CompilationOutput`.
- **`yargs`** -- Both `commands.ts` and `commands/index.ts` use the `Argv` type.
