import { ASTNodeType } from "solc-typed-ast/dist/ast/implementation";
import { EnumType, ErrorType, EventType, StructType } from "../ast";
import { ASTNodeKind } from "solc-typed-ast/dist/ast/implementation";
import { ASTNodeConstructorMap } from "solc-typed-ast/dist/ast/implementation";
import { ASTNodeMap } from "solc-typed-ast/dist/ast/implementation";
import { Block } from "solc-typed-ast";

abstract class TypeVisitor {
  visitStruct?(struct: StructType): void;
  visitEvent?(event: EventType): void;
  visitError?(error: ErrorType): void;
  visitEnumType?(_enum: EnumType): void;
}

type SolidityASTVisitor = {
  [K in ASTNodeKind as `visit_${K}`]: ((node: ASTNodeMap[K]) => any) | undefined;
};

const x: SolidityASTVisitor = {
  visit_Block: (node: Block) => {
    return 0;
  }
};
