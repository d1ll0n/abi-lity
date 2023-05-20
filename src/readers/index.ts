/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  ASTNode,
  ASTWriter,
  Assignment,
  Block,
  CompilationOutput,
  CompilerKind,
  DefaultASTWriterMapping,
  Expression,
  FunctionDefinition,
  Identifier,
  InferType,
  LatestCompilerVersion,
  ParameterList,
  PrettyFormatter,
  StructDefinition,
  TupleExpression,
  TypeName,
  VariableDeclaration,
  VariableDeclarationStatement,
  WasmCompiler,
  YulAssignment,
  YulIdentifier,
  assert,
  getCompilerForVersion,
  isInstanceOf,
  isReferenceType
} from "solc-typed-ast";
import {
  CompileHelper,
  StructuredText,
  addSeparators,
  coerceArray,
  writeNestedStructure
} from "../utils";
import { readTypeNodesFromSolidity } from "./read_code";
import path from "path";
import { readTypeNodesFromSolcAST } from "./read_solc_ast";
import { writeFileSync } from "fs";
import { ArrayType, BytesType, StructType, TypeNode, TypeNodeWithChildren } from "../ast";
import { typeNameToTypeNode } from "./read_solc_ast";
import chalk from "chalk";
import { err, warn } from "../test_utils/logs";
import { compile, getCompilerOptionsWithDefaults } from "../utils/compile_utils/solc";

export * from "./elementary";
export * from "./read_abi";
export * from "./read_code";
export * from "./read_solc_ast";
export * from "./types";

const sepp = (comment: string) => {
  let maxSize = Math.max(68, comment.length + 4);
  maxSize = maxSize + (maxSize % 2);
  const halfSpaceBefore = Math.ceil((maxSize - comment.length) / 2);
  const rows = [
    "/*".padEnd(maxSize, "/"),
    comment.padStart(halfSpaceBefore + comment.length, " "),
    "*/".padStart(maxSize, "/")
  ];
  return rows.join("\n");
};

async function readTypeNodesX() {
  // const files = new Map<string, string>();
  const input = path.join(
    `/home/pc/opensea/seaport-test-codec/contracts/lib/ConsiderationStructs.sol`
  );
  const fileName = path.parse(input).base;
  const basePath = path.dirname(input);
  // files.set("SomeFile.sol")
  const helper = await CompileHelper.fromFileSystem(LatestCompilerVersion, fileName, basePath);

  const nodes = readTypeNodesFromSolcAST(true, ...helper.sourceUnits);
  const code_out = [];
  const eventsAndErrors = [...nodes.events, ...nodes.errors];
  if (eventsAndErrors.length > 0) {
    code_out.push(sepp("events and errors"));
    code_out.push(
      `library EventsAndErrors {`,
      addSeparators(
        eventsAndErrors.map((node) => node.writeDefinition()),
        ""
      ),
      `}`,
      ""
    );
  }
  for (const key of ["enums", /* "functions", */ "structs"] as const) {
    const arr = nodes[key];
    if (arr.length === 0) continue;
    code_out.push(sepp(key));
    for (const node of arr) {
      code_out.push(node.writeDefinition());
    }
  }

  writeFileSync(
    path.join(__dirname, "generated.sol"),
    writeNestedStructure([
      `// SPDX-License-Identifier: MIT`,
      `pragma solidity ^0.8.0;`,
      ``,
      ...code_out
    ])
  );
}

function getAssignmentsToInScope(scope: ASTNode, target: VariableDeclaration) {
  const assignments = scope
    .getChildrenByType(Assignment)
    .filter((assignment) =>
      assignment.vLeftHandSide
        .getChildrenByType(Identifier, true)
        .some((n) => n.referencedDeclaration === target.id)
    )
    .flat();
  const yulAssignments = scope
    .getChildrenByType(YulAssignment)
    .filter((assignment) => assignment.variableNames.some((n) => n.name === target.name));

  return [...assignments, ...yulAssignments];
}

const varVars = (arr: any[]) => (arr.length > 1 ? `variables` : `variable`);
const thisThese = (arr: any[]) => (arr.length > 1 ? `these variables` : `this variable`);

function stripSingletonParens(e: Expression): Expression {
  while (e instanceof TupleExpression && e.vOriginalComponents.length === 1) {
    const comp = e.vOriginalComponents[0];
    assert(comp !== null, 'Unexpected "null" component in tuple with single element');
    e = comp;
  }

  return e;
}

class DeclarationAnalysis {
  assignments: Assignment[] = [];
  assignedValues: Expression[] = [];
  yulAssignments: YulAssignment[] = [];
  returnParameter: boolean;
  initialValue: Expression | undefined;

  constructor(public decl: VariableDeclaration, public type: TypeNode) {
    this.returnParameter = isReturnParameter(decl);
    if (!this.returnParameter) {
      if (decl.parent instanceof VariableDeclarationStatement) {
        const initialValue = decl.parent.vInitialValue;
        if (initialValue) {
          if (initialValue instanceof TupleExpression) {
            const index = decl.parent.vDeclarations.indexOf(decl);
            this.initialValue = initialValue.vComponents[index];
          } else {
            this.initialValue = initialValue;
          }
        }
      }
    }
    const assignments = getAssignmentsToInScope(
      decl.getClosestParentByType(FunctionDefinition)!.vBody!,
      decl
    );
    this.assignments = assignments.filter((a) => a instanceof Assignment) as Assignment[];
    this.yulAssignments = assignments.filter((a) => a instanceof YulAssignment) as YulAssignment[];
  }

  setAssignedValues() {
    if (this.assignedValues.length === this.assignments.length) return this.assignedValues;
    return (this.assignedValues = this.assignments.map((a) => getAssignedValue(a, this.decl)));
  }
}

function getAssignedValue(assignment: Assignment, decl: VariableDeclaration) {
  const left = stripSingletonParens(assignment.vLeftHandSide);
  const right = assignment.vRightHandSide;
  if (left instanceof TupleExpression && right instanceof TupleExpression) {
    const idx = left.vComponents.findIndex(
      (c) => (c as Identifier).referencedDeclaration === decl.id
    );
    assert(idx >= 0, `TupleExpression does not contain ${decl.name}`);
    return right.vComponents[idx];
  }
  return right;
}

function uninitializedDeclarations(fn: FunctionDefinition) {
  if (!fn.vBody) return [];
  const returnParameters = fn.vReturnParameters.vParameters;
  const declaredParameters = fn.vBody
    .getChildrenByType(VariableDeclarationStatement)
    .map((stmt: VariableDeclarationStatement) => stmt.vDeclarations)
    .flat();
  const declarations = [...returnParameters, ...declaredParameters]
    .map((decl) => ({ decl, type: typeNameToTypeNode(decl.vType as TypeName) }))
    .filter((decl) => decl.type.isReferenceType && !decl.type.isDynamicallySized);
  return declarations;
}

function checkFunction(fn: FunctionDefinition) {
  const declarations = uninitializedDeclarations(fn);
  const warnings: Warning[] = [];
  for (const decl of declarations) {
    warnings.push(...getWarningsForDeclaration(decl));
  }
  const output: StructuredText[] = [];
  for (const warning of warnings) {
    const text = TextEdit.fromNode(warning.node);
    const clr = color[warning.severity];
    text.highlightNode(warning.node, clr);
    output.push(
      "-".repeat(20),
      clr(`${warning.severity}: `) + warning.message,
      text.text,
      warning.notes ? coerceArray(warning.notes).map((t) => `- ${t}`) : [],
      "-".repeat(20)
    );
  }
  console.log(writeNestedStructure(output));
}

type DeclarationInfo = {
  decl: VariableDeclaration;
  type: TypeNode;
};

const isReturnParameter = (decl: VariableDeclaration) =>
  decl.parent instanceof ParameterList &&
  decl.parent.parent instanceof FunctionDefinition &&
  decl.parent === decl.parent.parent.vReturnParameters;

function isInitialized(decl: VariableDeclaration) {
  if (decl.parent instanceof VariableDeclarationStatement) {
    return !!decl.parent.vInitialValue;
  }
  if (isReturnParameter(decl)) {
    return false;
  }
  return false;
}

function getInitialMemorySize(type: TypeNode): number {
  if (type.isDynamicallySized) return 0;
  if (type instanceof ArrayType && type.length) {
    return (
      (getInitialMemorySize(type.baseType) + (type.baseType.isReferenceType ? 32 : 0)) * type.length
    );
  }
  if (type instanceof StructType) {
    return (
      type.vMembers.reduce((acc, member) => acc + getInitialMemorySize(member), 0) +
      type.embeddedMemoryHeadSize
    );
  }
  return 32;
}

function getWarningsForDeclaration({ decl, type }: DeclarationInfo) {
  const warnings: Warning[] = [];
  const isReturn = isReturnParameter(decl);
  if (!type.isReferenceType || type.isDynamicallySized) return warnings;
  if (!isInitialized(decl)) {
    warnings.push({
      severity: Severity.Warning,
      message: `Reference type declared without assignment: ${decl.name}`,
      node: decl,
      notes: [
        `The compiler will allocate & overwrite memory to initialize ${decl.name} with 0's.`,
        `If it is reassigned, this memory is wasted, as is the gas used to clear it.`,
        ...(type instanceof ArrayType
          ? [
              `Fixed arrays are particularly bad, as their initialization allocates and clears each element in a loop.`
            ]
          : []),
        isReturn
          ? `Consider initializing ${decl.name} to its final value in the declaration or using a type cast.`
          : `Consider using a type cast.`
      ]
    });
  }
  const assignments = getAssignmentsToInScope(
    decl.getClosestParentByType(FunctionDefinition)!.vBody!,
    decl
  );

  assignments.forEach((assignment) => {
    warnings.push({
      severity: Severity.Error,
      message: `Reference type reassigned: ${decl.name}`,
      node: assignment,
      notes: [
        err(
          `Global memory permanently expanded by ${getInitialMemorySize(
            type
          )} bytes for dropped reference.`
        ),
        `Cost of clearing memory is wasted.`
      ]
    });
  });

  return warnings;
}

class TextEdit {
  edits: Array<{ index: number; sizeDiff: number }> = [];
  originalText: string;
  constructor(public text: string, public sourceMap: Map<ASTNode, [number, number]>) {
    this.originalText = this.text;
  }
  getOffset(oldOffset: number) {
    let offset = 0;
    let lastEdit = 0;
    while (lastEdit < this.edits.length && this.edits[lastEdit].index < oldOffset) {
      offset += this.edits[lastEdit++].sizeDiff;
    }
    return offset;
  }
  replace(start: number, length: number, replacement: string) {
    const sizeDiff = replacement.length - length;
    this.edits.push({ index: start, sizeDiff });
    this.edits.sort((a, b) => a.index - b.index);
    const offset = this.getOffset(start);
    this.text =
      this.text.slice(0, start + offset) + replacement + this.text.slice(start + length + offset);
  }
  highlightNode(node: ASTNode, color = chalk.redBright) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const [offset, length] = this.sourceMap.get(node)!;
    this.replace(offset, length, color(this.originalText.slice(offset, offset + length)));
  }
  replaceNode(node: ASTNode, replacement: string) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const [offset, length] = this.sourceMap.get(node)!;
    this.replace(offset, length, replacement);
  }
  static fromNode(node: ASTNode) {
    const writer = new ASTWriter(
      DefaultASTWriterMapping,
      new PrettyFormatter(2),
      LatestCompilerVersion
    );
    const sourceMap = new Map<ASTNode, [number, number]>();
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
      const text = new TextEdit(writer.write(parent, sourceMap), sourceMap);
      if (body) {
        text.replaceNode(body, `{`);
      }
      return text;
    }
    if (parent instanceof VariableDeclarationStatement) {
      parent = node.getClosestParentByType(FunctionDefinition);
    }

    /* if (parent instanceof Block) {
      return new TextEdit(writer.write(parent, sourceMap), sourceMap);
    } */

    return new TextEdit(writer.write(parent ?? node.parent ?? node, sourceMap), sourceMap);
  }
}

enum Severity {
  Warning = "Warning",
  Error = "Error"
}

type Warning = {
  message: string;
  node: ASTNode;
  severity: Severity;
  notes?: StructuredText;
};

const color = {
  [Severity.Warning]: warn,
  [Severity.Error]: err
};

async function docomp(files: Map<string, string>) {
  const version = LatestCompilerVersion;
  const CompilerOutputs = [CompilationOutput.AST];
  const compiler = await getCompilerForVersion(version, CompilerKind.WASM);
  if (!(compiler instanceof WasmCompiler)) {
    throw Error(`WasmCompiler not found for ${version}`);
  }
  const compileResult = compile(compiler, files, [], CompilerOutputs);
  return new CompileHelper(compiler, compileResult);
}

async function runtest() {
  const files = new Map<string, string>();
  files.set(
    "SomeFile.sol",
    `
   contract A {
    struct Info {
      uint256 a;
    }
    function bar(
      uint a0,
      uint a1,
      uint a2,
      uint a3,
      uint a4,
      uint a5,
      uint a6,
      uint a7,
      uint a8,
      uint a9
    ) external returns (uint256 a) {
      return (
        a0
        + a1
        + a2
        + a3
        + a4
        + a5
        + a6
        + a7
        + a8
        + a9
      );
    }
   }
    `
  );

  const time = Date.now();
  const helper = await CompileHelper.fromFiles(
    LatestCompilerVersion,
    files,
    "SomeFile.sol" /* true */,
    true,
    {
      viaIR: true,
      optimizer: true
    }
  );
  console.log(`Compile time: ${Date.now() - time}ms`);

  const t2 = Date.now();
  const helper2 = await docomp(files);
  console.log(`Compile time: ${Date.now() - t2}ms`);
  console.log(`${helper2.sourceUnits.length} | ${helper.sourceUnits.length}}`);
  if (t2 > 0) {
    return;
  }
  const { irOptimized } = helper.getContractForFile("SomeFile.sol");
  // console.log(irOptimized);
  const sourceUnit = helper.sourceUnits[0];
  const fn = sourceUnit.getChildrenByType(FunctionDefinition)[0];
  checkFunction(fn);

  // const decl = sourceUnit.getChildrenByType(VariableDeclaration)[0];
  // const text = TextEdit.fromNode(decl);
  // const scope = decl.vScope;
  // console.log(scope.type);
  // text.highlightNode(decl);
  // console.log(text.text);
  // const ids = getIdentifiersInScope(scope, decl);
  // console.log(ids.map((id) => id.type));
  // console.log(irOptimized);
}
// runtest();
