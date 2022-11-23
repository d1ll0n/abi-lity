import { ASTContext, EnumType, ErrorType, EventType, FunctionType, StructType } from "../ast";

export type TypeNodeReaderResult = {
  context: ASTContext;
  functions: FunctionType[];
  structs: StructType[];
  events: EventType[];
  errors: ErrorType[];
  enums: EnumType[];
};
