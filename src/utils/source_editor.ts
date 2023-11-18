/* eslint-disable @typescript-eslint/no-non-null-assertion */
import chalk, { ForegroundColor } from "chalk";
import {
  ASTNode,
  ASTWriter,
  Assignment,
  Block,
  ContractDefinition,
  DefaultASTWriterMapping,
  EnumDefinition,
  ErrorDefinition,
  EventDefinition,
  FunctionDefinition,
  LatestCompilerVersion,
  ModifierDefinition,
  ParameterList,
  PrettyFormatter,
  SourceUnit,
  StructDefinition,
  TupleExpression,
  VariableDeclarationStatement,
  YulAssignment,
  isInstanceOf
} from "solc-typed-ast";

export type ASTSourceMap = Map<ASTNode, [number, number]>;
export type SourceUnitSourceMaps = Map<string, ASTSourceMap>;
// export
type ColorName = typeof ForegroundColor;

export class SourceEditor {
  edits: Array<{ index: number; sizeDiff: number }> = [];
  originalText: string;

  constructor(public text: string, public sourceMap: Map<ASTNode, [number, number]>) {
    this.originalText = this.text;
  }

  getOffset(oldOffset: number): number {
    let offset = 0;
    let lastEdit = 0;
    while (lastEdit < this.edits.length && this.edits[lastEdit].index < oldOffset) {
      offset += this.edits[lastEdit++].sizeDiff;
    }
    return offset;
  }

  _replace(start: number, length: number, replacement: string): void {
    const sizeDiff = replacement.length - length;
    this.edits.push({ index: start, sizeDiff });
    this.edits.sort((a, b) => a.index - b.index);
    const offset = this.getOffset(start);
    this.text =
      this.text.slice(0, start + offset) + replacement + this.text.slice(start + length + offset);
  }

  _insertAt(start: number, text: string): void {
    const length = text.length;
    this.edits.push({ index: start, sizeDiff: length });
    this.edits.sort((a, b) => a.index - b.index);
    const offset = this.getOffset(start);
    this.text = this.text.slice(0, start + offset) + text + this.text.slice(start + offset);
  }

  replace(node: ASTNode, replacement: string): void {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const [offset, length] = this.sourceMap.get(node)!;
    this._replace(offset, length, replacement);
  }

  append(node: ASTNode, text: string): void {
    const [offset, length] = this.sourceMap.get(node)!;
    if (
      isInstanceOf(
        node,
        FunctionDefinition,
        ContractDefinition,
        Block,
        ErrorDefinition,
        EventDefinition,
        EnumDefinition,
        ModifierDefinition,
        StructDefinition,
        ParameterList,
        TupleExpression
      )
    ) {
      this._insertAt(offset + length - 1, text);
    } else {
      this._insertAt(offset + length, text);
    }
  }

  highlightNode(node: ASTNode, color: chalk.Chalk | ColorName = chalk.redBright): void {
    if (typeof color === "string") {
      color = chalk[color as ColorName];
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const [offset, length] = this.sourceMap.get(node)!;
    this.replace(node, color(this.originalText.slice(offset, offset + length)));
  }

  insertAfter(node: ASTNode, text: string): void {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const [offset, length] = this.sourceMap.get(node)!;
    this._insertAt(offset + length, text);
  }

  insertBefore(node: ASTNode, text: string): void {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const [offset] = this.sourceMap.get(node)!;
    this._insertAt(offset, text);
  }

  static sourceUnitFromNode(node: ASTNode): SourceEditor {
    const writer = new ASTWriter(
      DefaultASTWriterMapping,
      new PrettyFormatter(2),
      LatestCompilerVersion
    );
    const sourceMap = new Map<ASTNode, [number, number]>();
    const sourceUnit = node.getClosestParentByType(SourceUnit) as SourceUnit;
    const sourceCode = writer.write(sourceUnit, sourceMap);
    return new SourceEditor(sourceCode, sourceMap);
  }

  static fromNode(node: ASTNode, onlyTopLevel?: boolean): SourceEditor {
    const writer = new ASTWriter(
      DefaultASTWriterMapping,
      new PrettyFormatter(2),
      LatestCompilerVersion
    );
    const sourceMap = new Map<ASTNode, [number, number]>();
    if (onlyTopLevel) {
      let parent = node.getClosestParentBySelector(
        (n) =>
          (n instanceof Block && n.parent instanceof FunctionDefinition) ||
          isInstanceOf(
            n,
            Block,
            FunctionDefinition,
            Assignment,
            YulAssignment,
            VariableDeclarationStatement
          )
      );
      if (parent instanceof FunctionDefinition) {
        const body = parent.vBody;
        const text = new SourceEditor(writer.write(parent, sourceMap), sourceMap);
        if (body) {
          text.replace(body, `{`);
        }
        return text;
      }
      if (parent instanceof VariableDeclarationStatement) {
        parent = node.getClosestParentByType(FunctionDefinition);
      }
      if (parent) {
        node = parent;
      }
    }
    return new SourceEditor(writer.write(node, sourceMap), sourceMap);
  }
}
