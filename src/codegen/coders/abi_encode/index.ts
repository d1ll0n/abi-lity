/**
 * AST-based ABI encoding module.
 *
 * Re-exports the AbiEncodeVisitor and specialized encoding function creators
 * for return, emit, revert, hash, and general abi.encode operations.
 */
export * from "./abi_encode_visitor";
export { createAbiEncodingFunctionWithAllocation } from "./create_abi_encode";
export { createEmitFunction } from "./create_emit";
export { createHashFunction } from "./create_hash";
export {
  createReturnFunction,
  createReturnFunctionForReturnParameters,
  replaceReturnStatementsWithCall
} from "./create_return";
