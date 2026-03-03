/**
 * Code generation module — the output layer of abi-lity.
 *
 * Re-exports from three submodules:
 * - `abi_decode` — Text-based ABI decoding code generation (StructuredText approach)
 * - `abi_encode` — Text-based ABI encoding code generation (StructuredText approach)
 * - `generate` — Main orchestration entry point that delegates to the AST-based coders
 */
export * from "./abi_decode";
export * from "./abi_encode";
export * from "./generate";
