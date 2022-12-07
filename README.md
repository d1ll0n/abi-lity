# abi-lity

Solidity codegen tool for efficient ABI encoding/decoding.

Currently supports decoding calldata. Returndata decoding and ABI encoding are target features.

**Note:** Overflow protection is implemented by masking the last 4 bytes of any component which is used to derive a calldata pointer or length, provided that that value still yields valid ABI encoding. This may result in inconsistent behavior between abi-lity and solc's decoders. It may not revert when given an offset or length which would cause a pointer to overflow, whereas solc would throw in that case.

## Build

```
yarn && yarn build
chmod +x ./dist/cli.js
sudo npm link
```

## Decoder codegen

To generate decoders for a contract and automatically modify all external functions to use the decoders and a function switch, run:

```
abi-lity ./input-sol-file ./output-dir
``` 

**Flags**

`-d, --decoderOnly` only generate decoding files, do not modify the contract

`-y, --ir ` output `irOptimized` for the contract

`-u, --irUnoptimized` output `ir` (unoptimized) for the contract in addition to the optimized IR

`-v, --verbose` By default, all comments in the IR output will be removed. Setting this flag will keep them in.

## IR codegen

To generate `irOptimized` for a contract:

```
abi-lity ir ./input-sol-file ./output-dir
```

**Flags**

`-u, --unoptimized` output `ir` (unoptimized) for the contract in addition to the optimized IR

`-v, --verbose` By default, all comments in the IR output will be removed. Setting this flag will keep them in.

## Known Bugs

Currently only applies function edits to contract in root file, not any inherited contracts. This also means any overridden functions in the root file will break. Overrides will be removed if the function is modified, but the inherited contract will not be edited or removed.

Currently breaks if more than one contract is defined in root file.

