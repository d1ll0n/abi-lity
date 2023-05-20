import { isInstanceOf } from "solc-typed-ast";
import { PossibleReferenceTypes, UReferenceType } from "./reference";
import { TypeNode } from "./type_node";
import { PossibleValueTypes, UValueType } from "./value";

export * from "./reference";
export * from "./value";
export * from "./type_node";
export * from "./type_provider";
export * from "./ast_context";
export * from "./type_node_visitor";

export type UABIType = UReferenceType | UValueType;
export const PossibleABITypes = [...PossibleValueTypes, ...PossibleReferenceTypes];
export const isUABIType = (type: TypeNode): type is UABIType => {
  return isInstanceOf(type, ...PossibleABITypes);
};
