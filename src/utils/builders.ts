import { ContractDefinition, FunctionDefinition, SourceUnit } from "solc-typed-ast";
import { ASTNodeKind } from "solc-typed-ast/dist/ast/implementation";
import {
  ASTNodeConstructorOf,
  ASTNodeMap,
  ASTNodeType
} from "solc-typed-ast/dist/ast/implementation";
import { findFunctionDefinition } from "./solc_ast_utils";

type FnFor<T, R> = ((x: T, ...args: any[]) => R) extends /* extends */ (
  x: T,
  ...args: infer U
) => any
  ? (x: T, ...args: U) => R
  : never;

type SearchFunction<T extends ASTNodeType> = FnFor<SourceUnit | ContractDefinition, T | undefined>;
/* ((parent: SourceUnit,...args: any[]) => T | undefined)
  extends ((parent: SourceUnit, ...args: infer Args) => T | undefined) ?
  (parent: SourceUnit, ...args: Args) => T | undefined */

/* export abstract class Builder<T extends ASTNodeType> {
  static abstract nodeKind: T["type"];
  abstract findNode: SearchFunction<T>;
} */

export type NodeAdder<T extends ASTNodeType, Args extends any[]> = {
  findNode: SearchFunction<T>;
};

type NodeSearchMap = {
  [K in keyof ASTNodeMap]: SearchFunction<ASTNodeMap[K]>;
};

const NodeSearchMethods = {
  FunctionDefinition: (parent: SourceUnit | ContractDefinition, name: string) =>
    findFunctionDefinition(parent, name)
} as const;

type SearchFn<T extends NodeSearchMap> = {
  [K in keyof typeof NodeSearchMethods]: T[K];
};

// type Addition<Target extends ContractDefinition | SourceUnit, NodeType extends keyof ASTNodeMap> = {
//   type: NodeType;
//   find;
// };
