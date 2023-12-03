import {
  ASTKind,
  ASTNode,
  ASTReader,
  SourceLocation,
  SourceUnit,
  YulASTNode,
  YulObject
} from "solc-typed-ast";
import { ModernConfiguration } from "solc-typed-ast/dist/ast/modern";

const DepthMap = new Map<ASTNode, number>();
const TextMap = new Map<ASTNode, string>();
const NativeTextMap = new Map<ASTNode, string>();

function mapDepth(node: ASTNode, depth = 0): void {
  DepthMap.set(node, depth);
  for (const child of node.children) {
    mapDepth(child, depth + 1);
  }
}

function removeDescendantsFromList(nodes: ASTNode[]): ASTNode[] {
  return nodes.filter((node) => {
    return !nodes.some((n) => node.getClosestParentBySelector((p) => p === n));
  });
}

/* const sortByTextLengthAndDepth = (nodes, key, shortest = true) => {
  nodes.sort((a, b) => {
    if (a[key] === undefined) {
      console.log(a);
      throw new Error(`No ${key} property found on node ${a.id}`);
    }
    if (b[key] === undefined) {
      console.log(b);
      throw new Error(`No ${key} property found on node ${b.id}`);
    }
    let lengthDiff = a[key].length - b[key].length;
    if (!shortest) lengthDiff *= -1;
    if (lengthDiff) return lengthDiff;
    let depthDiff = (a.depth ?? 0) - (b.depth ?? 0);
    if (!shortest) depthDiff *= -1;
    return depthDiff;
  });
}; */

class YulSource {
  allNodes: YulASTNode[] = [];

  constructor(
    public ctx: ContractContext,
    public yulObject: YulObject,
    public yulSourceCode: string,
    public isOptimized: boolean
  ) {
    mapDepth(yulObject);
    this.allNodes = [...yulObject.requiredContext.nodes];
  }

  getAllNodesContainedWithinNativeSrc(parentSource: SourceLocation): YulASTNode[] {
    const parentEnd = parentSource.offset + parentSource.length;
    return this.allNodes.filter((node) => {
      if (!node.nativeSrc) return false;
      // In irOptimizedAst, `nativeSrc` points to the parent source (`ir`)
      // while in irAst it points to the node's own source.
      const source = this.isOptimized ? node.nativeSourceInfo : node.sourceInfo;
      const end = source.offset + source.length;
      return (
        source.sourceIndex === parentSource.sourceIndex &&
        source.offset >= parentSource.offset &&
        end <= parentEnd
      );
    });
  }

  getText(node: ASTNode): string {
    if (!TextMap.has(node)) {
      const { offset, length } = this.isOptimized ? node.sourceInfo : node.nativeSourceInfo;
      TextMap.set(node, this.yulSourceCode.slice(offset, offset + length));
    }
    return TextMap.get(node)!;
  }
}

class ContractContext {
  ir: YulSource;
  irOptimized: YulSource;

  constructor(
    public name: string,
    public sourceCode: string,
    public sourceUnit: SourceUnit,
    ir: string,
    irAst: YulObject,
    irOptimized: string,
    irOptimizedAst: YulObject
  ) {
    this.ir = new YulSource(this, irAst, ir, false);
    this.irOptimized = new YulSource(this, irOptimizedAst, irOptimized, true);
  }
}

function extractContractOutput(data: any, sources: Map<string, string>) {
  const reader = new ASTReader();
  const sourceUnits = reader.read(data, ASTKind.Modern, sources);
  const contractContexts = new Map<string, ContractContext[]>();
  for (const sourceUnit of sourceUnits) {
    // const contractOutputs = new Map<string, ContractOutput[]>();
    const contractOutputs: ContractContext[] = [];
    const contracts = data.contracts?.[sourceUnit.sourceEntryKey] ?? {};
    for (const [contractName, contractOutput] of Object.entries(contracts as Record<string, any>)) {
      const { ir, irAst, irOptimized, irOptimizedAst } = contractOutput;
      contractOutputs.push(
        new ContractContext(
          contractName,
          sources.get(sourceUnit.sourceEntryKey)!,
          sourceUnit,
          ir,
          new ASTReader().convert(irAst, ModernConfiguration) as YulObject,
          irOptimized,
          new ASTReader().convert(irOptimizedAst, ModernConfiguration) as YulObject
        )
      );
    }
    contractContexts.set(sourceUnit.sourceEntryKey, contractOutputs);
  }
  return contractContexts;
}
