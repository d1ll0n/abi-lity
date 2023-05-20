/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  assert,
  ASTNodeFactory,
  ASTReader,
  CompilationOutput,
  findAllFiles,
  FunctionDefinition,
  SourceUnit,
  ContractDefinition,
  ASTKind,
  parsePathRemapping,
  ASTNode,
  ASTNodeWithChildren,
  isInstanceOf,
  PragmaDirective,
  ImportDirective,
  ASTSearch
} from "solc-typed-ast";
import { ASTSourceMap, SourceEditor } from "../source_editor";
import {
  EnumDefinition,
  ErrorDefinition,
  EventDefinition,
  StructDefinition
} from "solc-typed-ast/dist/ast/implementation";
import { CompileHelper } from "./compile_helper";
import { compile } from "./solc";
import { getParentSourceUnit } from "../solc_ast_utils";

export type CodeMutation = (SourceUnitAddition | NodeMutation) & {
  id?: string;
  cb?: (node: ASTNode) => void;
};

type SourceUnitAddition = {
  kind: "addSourceUnit";
  sourceUnitName: string;
  code: string;
};
type NodeMutation =
  | {
      kind: "insertBefore";
      referenceNode: ASTNode;
      code: string;
      findResultingNode: (sourceUnit: SourceUnit) => ASTNode;
    }
  | {
      kind: "insertAfter";
      referenceNode: ASTNode;
      code: string;
      findResultingNode: (sourceUnit: SourceUnit) => ASTNode;
    }
  | {
      kind: "append";
      referenceNode: ASTNode;
      code: string;
      findResultingNode: (sourceUnit: SourceUnit) => ASTNode;
    };

type NonSourceUnitMutation = Exclude<CodeMutation, { kind: "addSourceUnit" }>;

class MutationApplier {
  editors = new Map<string, SourceEditor>();
  sourceUnitsByMutation: Map<Exclude<CodeMutation, { kind: "addSourceUnit" }>, SourceUnit> =
    new Map();
  factory: ASTNodeFactory;
  newSourceUnitsByName: Map<string, SourceUnit>;
  resultingNodes: ASTNode[];
  files: Map<string, string>;
  sourceMap: ASTSourceMap = new Map();

  constructor(public helper: CompileHelper, public mutations: CodeMutation[]) {
    this.files = helper.getFiles(this.sourceMap);
    this.applySourceMutations();
    this.factory = new ASTNodeFactory(this.helper.context);
    this.newSourceUnitsByName = this.compile();
    this.resultingNodes = this.applyResults();
    for (let i = 0; i < this.mutations.length; i++) {
      const mutation = this.mutations[i];
      const result = this.resultingNodes[i];
      if (mutation.cb !== undefined) {
        mutation.cb(result);
      }
    }
  }

  protected addSourceUnit({ sourceUnitName, code }: SourceUnitAddition) {
    const sourceUnitPath = this.helper.normalizePath(sourceUnitName);
    assert(
      !this.files.has(sourceUnitPath),
      `MutationApplier: Source unit ${sourceUnitPath} already exists`
    );
    this.files.set(sourceUnitPath, code);
  }

  protected copyNewSourceUnit({
    sourceUnitName
  }: Extract<CodeMutation, { kind: "addSourceUnit" }>) {
    const expectedPath = this.helper.normalizePath(sourceUnitName);
    const sourceUnitPath = [...this.newSourceUnitsByName.keys()].find(
      (unitPath) => this.helper.normalizePath(unitPath) === expectedPath
    );
    assert(
      sourceUnitPath !== undefined,
      `MutationApplier: Source unit ${sourceUnitName} not found after applying mutations`
    );
    const sourceUnit = this.factory.copy(this.newSourceUnitsByName.get(sourceUnitPath)!);
    this.helper.sourceUnits.push(sourceUnit);
    return sourceUnit;
  }

  protected mutateNodeSource(mutation: NonSourceUnitMutation) {
    // Find the reference node to position the code relative to in the edited source
    let referenceNode: ASTNode;
    if (mutation.kind === "insertBefore" || mutation.kind === "insertAfter") {
      referenceNode = mutation.referenceNode;
      assert(
        referenceNode.parent !== undefined,
        `Can not perform ${mutation.kind} mutation on a node without a parent. Consider using append instead.`
      );
    } else {
      referenceNode = mutation.referenceNode;
    }
    const sourceUnit =
      referenceNode instanceof SourceUnit ? referenceNode : getParentSourceUnit(referenceNode);

    this.sourceUnitsByMutation.set(mutation, sourceUnit);
    const sourcePath = sourceUnit.absolutePath;
    const editor = this.getEditor(sourcePath);
    editor[mutation.kind](referenceNode, mutation.code);
  }

  protected copyResultingNode(mutation: NonSourceUnitMutation) {
    const sourceUnit = this.sourceUnitsByMutation.get(mutation)!;
    const newSourceUnit = this.newSourceUnitsByName.get(sourceUnit.absolutePath);
    assert(
      newSourceUnit !== undefined,
      `Source unit not found for ${mutation.kind} mutation of ${sourceUnit.absolutePath}`
    );
    const resultingNode = mutation.findResultingNode(newSourceUnit);
    assert(
      resultingNode !== undefined,
      `Resulting node not found in compiled code after ${mutation.kind} mutation of ${sourceUnit.absolutePath}`
    );
    const node = this.factory.copy(resultingNode);
    if (mutation.kind === "insertBefore" || mutation.kind === "insertAfter") {
      (mutation.referenceNode.parent! as ASTNodeWithChildren<ASTNode>)[mutation.kind](
        node,
        mutation.referenceNode
      );
    } else {
      (mutation.referenceNode as ASTNodeWithChildren<ASTNode>).appendChild(node);
    }
    return node;
  }

  protected compile() {
    for (const [sourcePath, editor] of this.editors.entries()) {
      this.files.set(sourcePath, editor.text);
    }

    const resolvedFileNames = new Map<string, string>();
    findAllFiles(
      this.files,
      resolvedFileNames,
      parsePathRemapping(this.helper.remapping ?? []),
      []
    );
    const compileResult = compile(this.helper.compiler, this.files, this.helper.remapping ?? [], [
      CompilationOutput.AST
    ]);
    const reader = new ASTReader();
    return new Map<string, SourceUnit>(
      reader
        .read(compileResult, ASTKind.Modern, compileResult.files)
        .map((sourceUnit) => [sourceUnit.absolutePath, sourceUnit])
    );
  }

  protected applyResults() {
    return this.mutations.map((mutation) => {
      if (mutation.kind === "addSourceUnit") {
        return this.copyNewSourceUnit(mutation);
      }
      return this.copyResultingNode(mutation);
    });
  }

  protected applySourceMutations() {
    for (const mutation of this.mutations) {
      if (mutation.kind === "addSourceUnit") {
        this.addSourceUnit(mutation);
      } else {
        this.mutateNodeSource(mutation);
      }
    }
  }

  getEditor(sourcePath: string) {
    if (!this.editors.has(sourcePath)) {
      this.editors.set(sourcePath, new SourceEditor(this.files.get(sourcePath)!, this.sourceMap));
    }
    const editor = this.editors.get(sourcePath);
    assert(editor !== undefined, `Editor not found for ${sourcePath}`);
    return editor;
  }
}

export function applyMutations(helper: CompileHelper, mutations: CodeMutation[]): ASTNode[] {
  const applier = new MutationApplier(helper, mutations);
  return applier.resultingNodes;
}

type UserDefinition =
  | ContractDefinition
  | StructDefinition
  | EnumDefinition
  | FunctionDefinition
  | EventDefinition
  | ErrorDefinition;

type DefinitionNodeKind = UserDefinition["type"];

export type InsertDefinitionOptions = {
  name: string;
  code: string;
  scope: SourceUnit | ContractDefinition;
  action?: Exclude<CodeMutation["kind"], "addSourceUnit">;
  referenceNode?: ASTNode;
  type: DefinitionNodeKind;
  cb?: (node: ASTNode) => void;
};

const notHeaderNode = (node: ASTNode) => !isInstanceOf(node, PragmaDirective, ImportDirective);

// const checkForDuplicate = ({
//   name,
//   code,
//   scope,
//   type
// }: InsertDefinitionOptions) => {
//   switch (type) {
//     case "StructDefinition":
//     case "ContractDefinition":
//       return ASTSearch.from(scope).find(type, { name }).length > 0;
//     case "FunctionDefinition": {
//       try {
//         const result = readTypeNodesFromSolidity(code, true);
//         if (result.functions.length === 1) {
//           const signature = result.functions[0].signatureInInternalFunction();
//           return scope.getChildrenBySelector(node => )
//         }
//       } catch (err) {
//         console.log(`Unexpected error while parsing mutation code for ${name}: ${err.message}`);
//       }
//     }
//   }
// };

export function getInsertionMutation({
  name,
  code,
  scope,
  action = "append",
  referenceNode,
  type,
  cb
}: InsertDefinitionOptions): NonSourceUnitMutation | undefined {
  if (ASTSearch.from(scope).find(type, { name }).length > 0) {
    return undefined;
  }

  if (!referenceNode && action !== "append") {
    if (action === "insertBefore") {
      referenceNode = scope.children.find(notHeaderNode);
    } else {
      referenceNode = scope.lastChild;
    }
  }

  code = `\n${code}\n`;

  if (!referenceNode) {
    action = "append";
    referenceNode = scope;
  }
  return {
    kind: action as any,
    referenceNode,
    code,
    findResultingNode: (sourceUnit) => {
      let search = ASTSearch.from(sourceUnit);
      if (scope instanceof ContractDefinition) {
        search = ASTSearch.from(search.find("ContractDefinition", { name: scope.name })[0]);
      }
      const node = search.find(type, { name })[0];
      if (!node) {
        console.log(`Could not find inserted function ${name}`);
      }
      return node;
    },
    cb
  };
}

export type InsertFunctionOptions = Omit<InsertDefinitionOptions, "type">;
