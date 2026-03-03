/**
 * Shared utilities for the abi-lity toolkit.
 *
 * Re-exports helpers grouped by concern: array/collection operations, byte/hex
 * manipulation, structured-text code generation, solc AST helpers, compilation
 * pipeline, file/path utilities, logging, type extraction, default value
 * generation, optimizer transforms, and syntax highlighting.
 */
export * from "./array";
export * from "./builtins";
export * from "./bytes";
export * from "./defaults";
export * from "./optimizer";
export * from "./solc_ast_utils";
export * from "./text";
export * from "./compile_helper";
export * from "./files";
export * from "./loggers";
export * from "./type_extractor";
export { highlightYul, highlightSolidity } from "./hljs";
