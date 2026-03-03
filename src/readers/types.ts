import { ASTContext, EnumType, ErrorType, EventType, FunctionType, StructType } from "../ast";

/**
 * Unified output type returned by all three reader paths
 * (`readTypeNodesFromSolcAST`, `readTypeNodesFromABI`, `readTypeNodesFromSolidity`).
 *
 * All returned TypeNodes are registered in the shared `context`, enabling
 * cross-references and lookup by ID.
 */
export type TypeNodeReaderResult = {
  context: ASTContext;
  functions: FunctionType[];
  structs: StructType[];
  events: EventType[];
  errors: ErrorType[];
  enums: EnumType[];
};
