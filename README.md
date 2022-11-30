# abi-lity

Solidity codegen tool for efficient ABI encoding/decoding.

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