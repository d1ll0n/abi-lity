import { ASTContext, EnumType, ErrorType, EventType, FunctionType, StructType } from "../ast";
import { UserDefinedValueType } from "../ast/value/user_defined_value_type";

export type TypeNodeReaderResult = {
  context: ASTContext;
  functions: FunctionType[];
  structs: StructType[];
  events: EventType[];
  errors: ErrorType[];
  enums: EnumType[];
  userDefinedValueTypes: UserDefinedValueType[];
};
