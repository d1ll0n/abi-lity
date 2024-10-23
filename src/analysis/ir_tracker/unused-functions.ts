/* eslint-disable @typescript-eslint/no-non-null-assertion */
import path from "path";
import {
  ASTKind,
  ASTNode,
  ASTReader,
  ASTSearch,
  ASTWriter,
  SourceLocation as BaseSourceLocation,
  CompilationOutput,
  ContractDefinition,
  DefaultASTWriterMapping,
  ExternalReferenceType,
  FunctionCall,
  FunctionDefinition,
  FunctionKind,
  FunctionVisibility,
  LatestCompilerVersion,
  PrettyFormatter,
  SourceUnit,
  StructDefinition,
  YulASTNode,
  YulBlock,
  YulFunctionCall,
  YulFunctionDefinition,
  YulIdentifier,
  YulObject,
  YulTypedName,
  YulVariableDeclaration,
  assert,
  isInstanceOf
} from "solc-typed-ast";
import { ModernConfiguration } from "solc-typed-ast/dist/ast/modern";
import { CompileHelper } from "../../utils/compile_utils/compile_helper";
import { SolidityStoragePositionsTracker, StoragePosition } from "../solidity_storage_positions";
import { mkdirSync, writeFileSync } from "fs";
import { structDefinitionToTypeNode } from "../../readers/read_solc_ast";
import { packWord } from "../../codegen/coders/storage_cache/accessors/pack_word";
import { getCommonBasePath, getRelativePath, writeNestedStructure } from "../../utils";
import { getReferencesToFunctionOrVariable } from "../../utils/references";

const Writer = new ASTWriter(
  DefaultASTWriterMapping,
  new PrettyFormatter(2),
  LatestCompilerVersion
);
const printNode = (node: ASTNode): string => Writer.write(node);
const DepthMap = new Map<ASTNode, number>();
const TextMap = new Map<ASTNode, string>();
const NativeTextMap = new Map<ASTNode, string>();

function mapDepth(node: ASTNode, depth = 0): void {
  DepthMap.set(node, depth);
  for (const child of node.children) {
    mapDepth(child, depth + 1);
  }
}

function withoutDescendants(nodes: ASTNode[]): ASTNode[] {
  return nodes.filter((node) => {
    return !nodes.some((n) => node.getClosestParentBySelector((p) => p === n));
  });
}

export type SourceLocation = BaseSourceLocation & { endOffset: number };
const toSourceLocation = (src: BaseSourceLocation): SourceLocation => {
  return { ...src, endOffset: src.offset + src.length };
};

const ExcludeConstructor = true;

function getAllNodesAndMapDepth(node: YulASTNode, depth?: number): YulASTNode[];
function getAllNodesAndMapDepth(node: ASTNode, depth = 0): ASTNode[] {
  DepthMap.set(node, depth);
  const nodes = [node];
  for (const child of node.children) {
    nodes.push(...getAllNodesAndMapDepth(child, depth + 1));
  }
  return nodes;
}

/**
 * Returns the source location of the node in its own source code.
 * In `irOptimizedAst`, the `src` property points to the node's
 * source location in its own source code.
 * In `irAst`, the `src` property points to the node's source location
 * in the original source code.
 */
function getOwnSrc(node: ASTNode, isUnoptimizedIr = false): SourceLocation {
  if (isUnoptimizedIr) {
    if (!node.nativeSrc) {
      if (node instanceof YulObject) {
        node.nativeSrc = "-1:-1:-1";
      } else {
        console.log(Writer.write(node));
      }
    }
    return toSourceLocation(node.nativeSourceInfo);
  }
  return toSourceLocation(node.sourceInfo);
}

/**
 * Returns the source location of the node in the parent source code,
 * i.e. the source code that it was generated from.
 *
 * In `irOptimizedAst`, the `nativeSrc` property points to the node's
 * source location in the parent source code (`ir` output) while the `src` property
 * points to the node's source location in its own source code (`irOptimized` output).
 *
 * In `irAst`, the `nativeSrc` property points to the node's source location in its
 * own source code (`ir` output) while the `src` property points to the source location
 * in the parent source code (the original solidity code).
 */
function getParentSrc(node: ASTNode, isUnoptimizedIr = false): SourceLocation {
  if (isUnoptimizedIr) {
    return toSourceLocation(node.sourceInfo);
  }
  if (!node.nativeSrc) {
    if (node instanceof YulObject) {
      node.nativeSrc = "-1:-1:-1";
    } else {
      console.log(Writer.write(node));
    }
  }
  return toSourceLocation(node.nativeSourceInfo);
}

function mapArrInsert<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  if (!map.has(key)) map.set(key, []);
  map.get(key)!.push(value);
}

class YulSource {
  allNodes: YulASTNode[] = [];
  sourceIndexToNodes = new Map<number, YulASTNode[]>();
  parentSourceIndexToNodes = new Map<number, YulASTNode[]>();
  yulObject: YulObject | YulBlock;
  srcMap = new Map<YulASTNode, SourceLocation>();
  parentSrcMap = new Map<YulASTNode, SourceLocation>();

  getSrc(node: YulASTNode): SourceLocation | undefined {
    return this.srcMap.get(node);
  }

  getParentSrc(node: YulASTNode): SourceLocation | undefined {
    return this.parentSrcMap.get(node);
  }

  constructor(
    public ctx: ContractContext,
    yulObject: YulObject,
    public yulSourceCode: string,
    public isOptimized: boolean
  ) {
    let rootNode: YulBlock | YulObject = yulObject;
    if (ExcludeConstructor && !yulObject.name.includes("_deployed")) {
      const deployedObject = yulObject.vSubObjects[0];
      assert(
        deployedObject instanceof YulObject && deployedObject.name.includes("_deployed"),
        `Could not find deployed object in ${yulObject.name}`
      );
      rootNode = deployedObject.vCode.vBlock;
    }
    this.yulObject = rootNode;
    this.allNodes = getAllNodesAndMapDepth(rootNode);
    const parentSourceIndices = new Set<number>();
    const ownSourceIndices = new Set<number>();
    for (const node of this.allNodes) {
      const src = getOwnSrc(node, !isOptimized);
      this.srcMap.set(node, src);
      mapArrInsert(this.sourceIndexToNodes, src.sourceIndex, node);
      ownSourceIndices.add(src.sourceIndex);
      const parentSrc = getParentSrc(node, !isOptimized);
      this.parentSrcMap.set(node, parentSrc);
      mapArrInsert(this.parentSourceIndexToNodes, parentSrc.sourceIndex, node);
      parentSourceIndices.add(parentSrc.sourceIndex);
    }
    const label = isOptimized ? "irOptimized" : "ir";
    // console.log(
    //   `${label}: parent sources: ${[...parentSourceIndices.values()].join(",")} | own sources: ${[
    //     ...ownSourceIndices.values()
    //   ].join(",")} |
    //   # of nodes: ${this.allNodes.length}`
    // );
  }

  getAllNodesContainedWithinParentSrc(parentSource: SourceLocation): YulASTNode[] {
    const parentEnd = parentSource.endOffset;
    console.log(`Parent source index: ${parentSource.sourceIndex}`);
    console.log(
      `Available sources: ${[...this.parentSourceIndexToNodes.keys()]
        .map((x) => x.toString())
        .join(",")}`
    );
    const possibleNodes = this.parentSourceIndexToNodes.get(parentSource.sourceIndex) ?? [];
    console.log(`Possible nodes: ${possibleNodes.length}`);
    const allContainedNodes = possibleNodes.filter((node) => {
      const parentSrc = this.getParentSrc(node);
      if (!parentSrc) return false;
      return parentSrc.offset >= parentSource.offset && parentSrc.endOffset <= parentEnd;
    });
    console.log(`All contained nodes: ${allContainedNodes.length}`);
    const topLevelNodes = withoutDescendants(allContainedNodes);
    topLevelNodes.sort((a, b) => {
      // Sort nodes by offset
      const aSrc = this.getSrc(a) as SourceLocation;
      const bSrc = this.getSrc(b) as SourceLocation;
      return aSrc.offset - bSrc.offset;
    });
    return topLevelNodes;
  }
}

class ContractContext {
  ir?: YulSource;
  irOptimized?: YulSource;

  constructor(
    public name: string,
    public sources: Map<number, string>,
    public sourceUnit: SourceUnit,
    public contractOutput: any,
    ir?: string,
    irAst?: YulObject,
    irOptimized?: string,
    irOptimizedAst?: YulObject
  ) {
    this.ir = irAst && ir ? new YulSource(this, irAst, ir, false) : undefined;
    this.irOptimized =
      irOptimizedAst && irOptimized
        ? new YulSource(this, irOptimizedAst, irOptimized, true)
        : undefined;
  }

  getIrCodeGeneratedFromNode(node: ASTNode) {
    const src = getOwnSrc(node);
    return this.ir?.getAllNodesContainedWithinParentSrc(src);
  }
}

function extractContractOutput(data: any, sources: Map<string, string>) {
  const reader = new ASTReader();

  const sourceUnits = reader.read(data, ASTKind.Modern, sources);
  const sourceIndexMap = new Map<number, string>();
  for (const sourceUnit of sourceUnits) {
    sourceIndexMap.set(sourceUnit.sourceListIndex, sources.get(sourceUnit.sourceEntryKey)!);
  }
  const contractContexts = new Map<string, ContractContext[]>();
  const outDir = path.join(__dirname, "compiler-output");
  mkdirSync(outDir, { recursive: true });

  for (const sourceUnit of sourceUnits) {
    // const contractOutputs = new Map<string, ContractOutput[]>();
    const contractOutputs: ContractContext[] = [];
    const contracts = data.contracts?.[sourceUnit.sourceEntryKey] ?? {};
    for (const [contractName, contractOutput] of Object.entries(contracts as Record<string, any>)) {
      const { ir, irAst, irOptimized, irOptimizedAst } = contractOutput;
      //   if (!ir || !irAst || !irOptimized || !irOptimizedAst) continue;
      if (irAst) {
        writeFileSync(path.join(outDir, `${contractName}.ir.json`), JSON.stringify(irAst, null, 2));
      }
      if (ir) {
        writeFileSync(path.join(outDir, `${contractName}.ir.yul`), ir);
      }
      if (irOptimizedAst) {
        writeFileSync(
          path.join(outDir, `${contractName}.irOptimized.json`),
          JSON.stringify(irOptimizedAst, null, 2)
        );
      }
      if (irOptimized) {
        writeFileSync(path.join(outDir, `${contractName}.irOptimized.yul`), irOptimized);
      }

      contractOutputs.push(
        new ContractContext(
          contractName,
          sourceIndexMap,
          sourceUnit,
          contractOutput,
          ir,
          irAst && (new ASTReader().convert(irAst, ModernConfiguration) as YulObject),
          irOptimized,
          irOptimizedAst &&
            (new ASTReader().convert(irOptimizedAst, ModernConfiguration) as YulObject)
        )
      );
    }
    contractContexts.set(sourceUnit.sourceEntryKey, contractOutputs);
    console.log(sourceUnit.sourceEntryKey);
  }
  return contractContexts;
}

export enum LinkedYulVariableType {
  Address = "address",
  FunctionIdentifier = "FunctionIdentifier",
  FunctionSelector = "functionSelector",
  Gas = "gas",
  Length = "length",
  MemoryPointer = "mpos",
  Offset = "offset",
  Self = "self",
  Slot = "slot",
  Value = "value",
  Inner = "inner"
}

const PossibleLinkedYulVariableTypes = [
  LinkedYulVariableType.Address,
  LinkedYulVariableType.FunctionIdentifier,
  LinkedYulVariableType.FunctionSelector,
  LinkedYulVariableType.Gas,
  LinkedYulVariableType.Length,
  LinkedYulVariableType.MemoryPointer,
  LinkedYulVariableType.Offset,
  LinkedYulVariableType.Self,
  LinkedYulVariableType.Slot,
  LinkedYulVariableType.Value,
  LinkedYulVariableType.Inner
];

// function parseYulVariableName(node: YulTypedName | YulIdentifier) {
//   const [_, originalName, astId, suffix] =
//     /(var|expr)_([a-zA-Z0-9$_]+)((?:_)[0-9]+)(?:_([a-zA-Z]+))*"/g.exec(node.name) ?? [];
//   if (astId) {
//     return {
//       originAstID: astId,
//       suffix:
//         suffix && PossibleLinkedYulVariableTypes.includes(suffix as any)
//           ? (suffix as LinkedYulVariableType)
//           : undefined
//     };
//   }
// }

function parseYulName(name: string) {
  const [_, __, originalName, astId, suffix] =
    /(fun|var|expr)_([a-zA-Z0-9$_]+)((?:_)[0-9]+)(?:_([a-zA-Z]+))*/g.exec(name) ?? [];
  return { originalName, astId, suffix };
}

const CompileOptions = {
  outputs: [
    CompilationOutput.AST,
    CompilationOutput.EVM_ASSEMBLY,
    ...(process.argv.includes("--unused")
      ? []
      : [
          CompilationOutput.IR,
          CompilationOutput.IR_AST,
          CompilationOutput.IR_OPTIMIZED,
          CompilationOutput.IR_OPTIMIZED_AST
        ]),
    CompilationOutput.METADATA,
    CompilationOutput.EVM_BYTECODE,
    CompilationOutput.EVM_DEPLOYEDBYTECODE,
    CompilationOutput.EVM_BYTECODE_SOURCEMAP,
    CompilationOutput.EVM_BYTECODE_GENERATEDSOURCES
  ],
  settings: {
    viaIR: true,
    optimizer: {
      enabled: true,
      runs: 4_294_967_295
    },
    debug: {
      revertStrings: "default",
      debugInfo: ["*"]
    }
  },
  version: "0.8.25"
};

// Notes:
// For external functions, look for the function definition then find
// nodes contained within it.
// For internal functions / library functions from other files, look for the
// function call

const sourcePath = path.join(__dirname, "TestFile.sol");
async function testOutput() {
  const basePath = path.dirname(sourcePath);
  const fileName = path.parse(sourcePath).base;
  const helper = await CompileHelper.fromFileSystem(fileName, basePath, CompileOptions);
  const contexts = extractContractOutput(helper.compileResult, helper.compileResult.files);
  console.log([...contexts.keys()]);
  const entries = contexts.entries();
  for (const [sourcePath, contractContexts] of entries) {
    console.log(`Source path: ${sourcePath}`);
    for (const contractContext of contractContexts) {
      console.log(
        `Contract name: ${contractContext.name} | Source Index: ${contractContext.sourceUnit.sourceListIndex}`
      );
    }
  }

  const ctx = contexts.get(sourcePath)!.find((ctx) => ctx.name === "TestContract")!;
  const search = ASTSearch.from(
    [...contexts.values()].reduce(
      (arr, ctx) => [...arr, ...ctx.map((c) => c.sourceUnit)],
      [] as SourceUnit[]
    )
  );
  const fnDef = search.findFunctionsByName("getThirdWord")![0];
  // const fnCall = search.findFunctionCalls(fnDef)[0]!;
  // console.log(fnCall.sourceInfo);
  /*   const functionDefinition = ctx.sourceUnit
    .getChildrenByType(FunctionDefinition)
    .find((fd) => fd.name === "test2")!; */
  const nodes = ctx.getIrCodeGeneratedFromNode(fnDef)!;
  console.log(
    `Nodes generated from ${fnDef.name}: ${nodes.length}  | ${nodes.map((n) => n.type).join(",")}`
  );
}

function getMarketStatePositions(struct: StructDefinition) {
  const type = structDefinitionToTypeNode(struct);
  const positions = SolidityStoragePositionsTracker.getPositions(type);
  const bySlot: StoragePosition[][] = [];
  positions.map((pos) => {
    // console.log(`Position: ${pos.label} | ${pos.slot} | ${pos.slotOffsetBytes}`);
    if (bySlot.length === 0) {
      bySlot.push([pos]);
    } else {
      const lastSlot = bySlot[bySlot.length - 1];
      const lastPos = lastSlot[lastSlot.length - 1];
      if (lastPos.slot === pos.slot) {
        lastSlot.push(pos);
      } else {
        bySlot.push([pos]);
      }
    }
  });
  for (const slotMembers of bySlot) {
    const text = packWord(
      slotMembers.map((mem) => {
        return {
          ...mem,
          parentOffsetBits: mem.slotOffsetBytes * 8,
          parentOffsetBytes: mem.slotOffsetBytes
        };
      })
    );
    const comment: string[] = [];
    const { slot } = slotMembers[0];
    // comment.push(`Slot ${slot}`);
    for (const member of slotMembers) {
      comment.push(
        `// Slot ${slot} | [${member.slotOffsetBytes}:${
          member.slotOffsetBytes + member.bytesLength
        }] | ${member.label}`
      );
    }
    console.log(writeNestedStructure([...comment, text]));
  }
}

function isInternalFunction(fn: FunctionDefinition) {
  return (
    fn.visibility === FunctionVisibility.Internal ||
    fn.visibility === FunctionVisibility.Default ||
    fn.visibility === FunctionVisibility.Private
  );
}

const inheritingContractsByContract = new Map<ContractDefinition, ContractDefinition[]>();
// Map from function definition to functions that override it
const functionsToOverrides = new Map<FunctionDefinition, FunctionDefinition[]>();

function findUnusedFunctions(contexts: Map<string, ContractContext[]>, sourcePath: string) {
  const context = contexts.get(sourcePath)![0];
  const sourceUnits = [...context.sourceUnit.context!.nodes].filter(
    (node) => node instanceof SourceUnit
  ) as SourceUnit[];
  const search = ASTSearch.from(sourceUnits);
  const allInternalFunctions = search
    .find("FunctionDefinition", {
      notAny: [
        {
          kind: FunctionKind.Constructor
        },
        {
          kind: FunctionKind.Receive
        },
        {
          kind: FunctionKind.Fallback
        }
      ]
    })
    .filter(isInternalFunction);
  const numberOfInternalFunctions = allInternalFunctions.length;
  console.log(`Number of internal functions: ${numberOfInternalFunctions}`);
  const basePath = getCommonBasePath(sourceUnits.map((su) => su.absolutePath))!;
  /* for (const sourceUnit of sourceUnits) {
    if (!directories.some((dir) => sourceUnit.absolutePath.includes(dir))) {
      continue;
    }
    const functions = search.find("FunctionDefinition");
    const callsToDeposit = search.find("FunctionCall", {
      referencedDeclaration: functions.find((fn) => fn.name === "_depositUpTo")?.id,
      name: "_depositUpTo"
    });
    console.log(`Calls to depositUpTo: ${callsToDeposit.length}`);
  } */
  //   const allContracts = search.find("ContractDefinition");
  /*   for (const contract of allContracts) {
    const baseContracts = contract.vLinearizedBaseContracts;
    for (const baseContract of baseContracts) {
      mapArrInsert(inheritingContractsByContract, baseContract, contract);
    }
    for (const fn of contract.vFunctions) {
      if (fn.vOverrideSpecifier) {
        const overrides = fn.vOverrideSpecifier.vOverrides;
        for (const override of overrides) {
          const overriddenFn = override.vReferencedDeclaration;
          mapArrInsert(functionsToOverrides, overriddenFn, fn);
        }
  } */

  //   const functions = context.sourceUnit
  //     .getChildrenByType(FunctionDefinition)
  //     .filter(isInternalFunction);

  //   const referencesToDepositUpTo = search.find("Identifier", {
  //     referencedDeclaration: functions.find((fn) => fn.name === "_depositUpTo")?.id,
  //     name: "_depositUpTo"
  //   });

  /*   const callsToDeposit = search.find("Identifier", {
    referencedDeclaration: functions.find((fn) => fn.name === "_depositUpTo")?.id,
    name: "_depositUpTo",
    ancestors: [{ tag: "FunctionCall" }]
  }); */

  //   console.log(`References to depositUpTo: ${referencesToDepositUpTo.length}`);

  for (const fn of allInternalFunctions) {
    // Skip functions that are overriding other functions
    if (fn.vOverrideSpecifier) continue;

    const calls = getReferencesToFunctionOrVariable(search, fn);

    if (calls.length === 0) {
      const sourcePath = sourceUnits.find(
        (source) => source.sourceInfo.sourceIndex === fn.sourceInfo.sourceIndex
      )?.absolutePath;
      const sourceName = getRelativePath(basePath, sourcePath!);
      console.log(
        `Unused function: ${fn.name} in ${sourceName} @ ${fn.sourceInfo.offset}:${fn.sourceInfo.length}`
      );
    }
  }
}

async function doTest() {
  const sourcePath = `/root/wildcat/v2-protocol/src/market/WildcatMarket.sol`;
  // const sourcePath = `/root/wildcat/v2-protocol/src/BigContract.sol`;
  if (process.argv.includes("--unused")) {
    CompileOptions.settings.viaIR = false;
    CompileOptions.settings.optimizer.enabled = false;
    CompileOptions.settings.optimizer.runs = 0;
  }

  const basePath = path.dirname(sourcePath);
  const fileName = path.parse(sourcePath).base;
  const helper = await CompileHelper.fromFileSystem(fileName, basePath, CompileOptions);
  const contexts = extractContractOutput(helper.compileResult, helper.compileResult.files);
  const context = contexts.get(sourcePath)![0];

  const definition = [...context.sourceUnit.context!.nodes].find(
    (ast) => isInstanceOf(ast, StructDefinition) && ast.name === "MarketState"
  );
  console.log(`Did we find MarketState? ${!!definition}`);
  const functions = context.irOptimized?.yulObject.getChildrenByType(YulFunctionDefinition) ?? [];
  if (context.irOptimized) {
    console.log(`functions: ${functions.length}`);
    const userFunctions = functions.filter(
      (fn) => fn.name.startsWith("fun_") || fn.name.startsWith("function_")
    );
    console.log(`user functions: ${userFunctions.length}`);
    const duplicateFunctions = userFunctions.filter((fn) => {
      const { astId, suffix, originalName } = parseYulName(fn.name);
      return !!astId;
    });
    console.log(`Duplicate functions: ${duplicateFunctions.length}`);
    duplicateFunctions.map((fn) => {
      const { astId, suffix, originalName } = parseYulName(fn.name);
      console.log(`${fn.name} | name ${originalName} | ast id ${astId} | suffix ${suffix}`);
    });
  }

  if (process.argv.includes("--unused")) {
    findUnusedFunctions(contexts, sourcePath);
  }

  const printKeys = (obj: any, prefix: string) => {
    for (const key of Object.keys(obj)) {
      if (key === "functionDebugData") continue;
      const value = obj[key];
      if (typeof value === "object") {
        printKeys(value, `${prefix}.${key}`);
      } else {
        console.log(`${prefix}.${key}: ${typeof value}`);
      }
    }
  };

  // printKeys(context.contractOutput.evm, "evm");

  if (definition) {
    // getMarketStatePositions(definition as StructDefinition);
  }

  if (context.irOptimized) {
    const callsByFunctionDefinition = new Map<YulFunctionDefinition, YulFunctionCall[]>();
    context.irOptimized.yulObject.getChildrenByType(YulFunctionCall).map((fnCall) => {
      const vFunctionName = fnCall.vFunctionName;
      if (!vFunctionName.vReferencedDeclaration) {
        const fnDefinition = functions.find((fn) => fn.name === vFunctionName.name);
        if (fnDefinition) {
          vFunctionName.referencedDeclaration = fnDefinition.id;
        }
      }
      if (fnCall.vFunctionCallType === ExternalReferenceType.UserDefined) {
        if (!fnCall.vReferencedDeclaration) {
          console.log(`No referenced declaration found for ${fnCall.vFunctionName.name}`);
        }
        // const functionDefinition = functions.find((fn) => fn.name === fnCall.vFunctionName.name && fn.p );
        mapArrInsert(callsByFunctionDefinition, fnCall.vReferencedDeclaration, fnCall);
      }
    });
    const sorted = [...callsByFunctionDefinition.entries()].sort(
      (a, b) => b[1].length - a[1].length
    );
    const functionDefinitionToLength: Array<[YulFunctionDefinition, number]> = [];
    for (const [fn] of sorted) {
      console.log;
      const fnText = Writer.write(fn);
      const length = fnText.length;
      functionDefinitionToLength.push([fn, length]);
    }
    functionDefinitionToLength.sort((a, b) => b[1] - a[1]);
    for (const [fn, length] of functionDefinitionToLength.slice(0, 10)) {
      const numberOfCalls = callsByFunctionDefinition.get(fn)!.length;
      console.log(`Function: ${fn.name} | Length: ${length} | Calls: ${numberOfCalls}`);
    }
  }

  console.log(`code size: ${context.contractOutput.evm.deployedBytecode.object.length / 2 - 1}`);
  console.log(`initcode size: ${context.contractOutput.evm.bytecode.object.length / 2 - 1}`);
}

doTest();