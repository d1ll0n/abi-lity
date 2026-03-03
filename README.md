# abi-lity

Solidity codegen and inspection tool for efficient ABI encoding/decoding.

Generates optimized ABI decoders, JSON serializers, equality assertions, contract type libraries, and more. Also provides inspection commands for viewing compiled IR/Yul, function selectors, and contract code size.

**Note:** Overflow protection is implemented by masking the last 4 bytes of any component which is used to derive a calldata pointer or length, provided that that value still yields valid ABI encoding. This may result in inconsistent behavior between abi-lity and solc's decoders. It may not revert when given an offset or length which would cause a pointer to overflow, whereas solc would throw in that case.

## Build

```sh
yarn && yarn build
chmod +x ./dist/cli.js
sudo npm link
```

## Quick Start

View optimized Yul for a contract or function:

```sh
git clone git@github.com:transmissions11/solmate && cd solmate
abi-lity ir src/test/utils/mocks/MockERC20.sol --inspect transfer
```

Generate ABI decoding libraries and a function switch for a contract:

```sh
abi-lity ./src/MyContract.sol ./output-dir
```

## CLI Commands

Commands are organized into three groups: **Codegen**, **Inspection**, and **Test**.

### Codegen

#### `abi-lity <input> [output]` (default command)

Generates an ABI decoding library for all external function input/output types in a smart contract and optionally modifies the contract to use a function switch.

```
Options:
  -i, --input          Input Solidity file                              [required]
  -o, --output         Output directory, defaults to directory of input
  -d, --decoderOnly    Only generate ABI decoding library without modifying
                       the contract                    [boolean] [default: false]
  -y, --ir             Also generate irOptimized Yul   [boolean] [default: false]
  -u, --irUnoptimized  Also generate unoptimized IR    [boolean] [default: false]
  -v, --verbose        Keep constructor and sourcemap comments in IR output
                                                       [boolean] [default: false]
      --only           Only generate specified coders
                       (return, revert, hash, emit, encode, state)       [array]
```

#### `abi-lity iface <input> [output]`

Generates a Solidity interface file from a compiled contract or JSON ABI. Outputs `I<ContractName>.sol` files with struct/enum definitions, errors, events, and function signatures.

```
Options:
  -i, --input   Input Solidity or JSON file                            [required]
  -o, --output  Output directory, defaults to directory of input
```

#### `abi-lity wrappers <input> [output]`

Generates external wrapper functions for free and library functions in a Solidity file, enabling testing of internal/library functions through public entry points.

```
Options:
  -i, --input   Input Solidity file                                    [required]
  -o, --output  Output directory, defaults to directory of input
```

#### `abi-lity ptr-libs <input> [output]`

Generates pointer libraries for struct types, providing typed memory/calldata pointer accessors for struct fields.

```
Options:
  -i, --input   Input Solidity file                                    [required]
  -o, --output  Output directory                                       [required]
```

#### `abi-lity ctype <input> [output]`

Generates a custom Solidity type (user-defined value type wrapping `address`) and companion library for a contract or interface. The library provides optimized call functions for all external methods that avoid memory allocation by using inline assembly with scratch space.

```
Options:
  -i, --input     Input Solidity file                                  [required]
  -o, --output    Output directory                                     [required]
  -c, --contract  Name of the contract or interface                     [string]
  -z, --zeroUsedMemory  Zero out memory used past the free pointer
                                                       [boolean] [default: false]
  -s, --skipBase  Skip generating functions for inherited contracts
                                                       [boolean] [default: false]
```

#### `abi-lity assert_eq <input> [output]`

Generates Forge-compatible equality assertion functions (`assertEq` overloads) for Solidity struct types. The output extends `StdAssertions` with type-specific deep equality checks.

```
Options:
  -i, --input   Input Solidity file                                    [required]
  -o, --output  Output directory                                       [required]
  -s, --struct  Struct(s) to generate assertions for                     [array]
```

#### `abi-lity forge-json <input> [output]`

Generates Forge-compatible JSON serializer functions using Forge's `Vm` cheatcode interface. Supports structs, arrays, enums, and all value types.

```
Options:
  -i, --input   Input Solidity file                                    [required]
  -o, --output  Output directory                                       [required]
  -s, --struct  Struct(s) to generate serializers for                    [array]
```

#### `abi-lity json <input> [output]`

Generates pure Solidity JSON serializer functions that don't depend on Forge's `Vm` cheatcode. Builds JSON strings directly using `string.concat` and `JsonLib`.

```
Options:
  -i, --input   Input Solidity file                                    [required]
  -o, --output  Output directory                                       [required]
  -s, --struct  Struct(s) to generate serializers for                    [array]
```

#### `abi-lity rename <input> [output] [search] [replace]`

Case-aware find-and-replace across all Solidity files in a directory. The search/replace text must be in `snake_case`; the command automatically derives PascalCase, camelCase, and UPPERCASE variants.

```
Options:
  -i, --input            Input directory                               [required]
  -s, --search           Text to search for (snake_case)      [string] [required]
  -r, --replace          Text to replace with (snake_case)    [string] [required]
  -o, --output           Output directory, defaults to directory of input
  -f, --excludeFileNames Exclude file names from replacement
                                                       [boolean] [default: false]
```

### Inspection

#### `abi-lity ir <input> [output]`

Compiles a contract with `viaIR` and outputs the intermediate representation (Yul) generated by solc. By default, only outputs `irOptimized` with sourcemap comments and constructor stripped.

```
Options:
  -i, --input          Input Solidity file                             [required]
  -o, --output         Output directory, defaults to directory of input
      --ir             Include unoptimized IR output   [boolean] [default: false]
  -nc, --no-constructor  Exclude the constructor       [boolean] [default: false]
  -ns, --no-sourcemap  Exclude sourcemap comments      [boolean] [default: false]
  -r, --runs           Optimizer runs (number or "max")       [default: 200]
  -s, --inspect        Find specific Yul functions by name in the IR AST  [array]
  -a, --assembly       Include EVM assembly output     [boolean] [default: false]
```

**Example:**

```sh
abi-lity ir ./src/ERC20.sol --inspect transfer approve
# Inspects the transfer and approve functions in the optimized Yul
```

#### `abi-lity selectors <input> [name] [output]`

Computes and prints 4-byte function selectors for external functions. Accepts Solidity source files and JSON ABI/artifact files.

```
Options:
  -i, --input   Input Solidity or JSON file                            [required]
  -n, --name    Function name or signature to filter                    [string]
  -o, --output  Output directory, defaults to directory of input
```

#### `abi-lity size <input>`

Prints the runtime bytecode size of a compiled contract and the distance from the 24,577-byte EIP-170 limit.

```
Options:
  -i, --input       Input Solidity file                                [required]
  -u, --unoptimized Print unoptimized code size        [boolean] [default: false]
```

### Test

#### `abi-lity compare <input>`

Compares gas usage and code size across multiple contract implementations of the same functions. Compiles with maximum optimizer runs and `viaIR`, deploys all contracts, and runs comparative tests.

```
Options:
  -i, --input   Input Solidity or JSON file                            [required]
```

#### `abi-lity copy-test <input> [output]`

Generates calldata-to-memory copy functions for struct/tuple types, creates optimized versions using abi-lity encoders and function switches, then tests all three variants and compares gas and code size.

```
Options:
  -i, --input     Input Solidity file                                  [required]
  -o, --output    Output directory, defaults to directory of input
  -y, --ir        Also output irOptimized Yul          [boolean] [default: false]
  -r, --runs      Optimizer runs (number or "max")            [default: 200000]
      --optimize  Enable compiler optimizations        [boolean] [default: true]
      --no-ir     Disable viaIR during testing         [boolean] [default: false]
```

#### `abi-lity shim <input> [output]`

Generates Forge test shim contracts with fuzz, concrete, and failure test scaffolding.

```
Options:
  -i, --input     Input Solidity file                                  [required]
  -o, --output    Output directory, defaults to directory of input
  -f, --fuzz      Generate fuzz tests                  [boolean] [default: true]
      --concrete  Generate concrete tests              [boolean] [default: true]
      --failures  Generate failure tests               [boolean] [default: true]
```

## Architecture

See `docs/` for detailed module documentation:

- [`docs/type-system.md`](docs/type-system.md) — AST type node system
- [`docs/readers.md`](docs/readers.md) — Input readers (ABI JSON, Solidity source, solc AST)
- [`docs/codegen.md`](docs/codegen.md) — Code generation pipeline
- [`docs/utils.md`](docs/utils.md) — Utility modules
- [`docs/command_line.md`](docs/command_line.md) — CLI command architecture

## Known Bugs

- Currently only applies function edits to contract in root file, not any inherited contracts. Overridden functions in the root file will break — overrides will be removed if the function is modified, but the inherited contract will not be edited or removed.
- Currently breaks if more than one contract is defined in root file.
