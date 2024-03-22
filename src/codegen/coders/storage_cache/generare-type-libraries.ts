/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  ASTWriter,
  DefaultASTWriterMapping,
  LatestCompilerVersion,
  PrettyFormatter,
  StructDefinition
} from "solc-typed-ast";
import { WrappedSourceUnit } from "../../ctx/contract_wrapper";
import NameGen from "../../names";
import { PackedStackTypeGenerator } from "./pack-stacker";
import { PackedMemoryTypeGenerator } from "./packed-memory-struct";
import { ArrayType, StructType } from "../../../ast";
import { writeFileSync } from "fs";
import { CompileHelper } from "../../../utils/compile_utils/compile_helper";
import { readTypeNodesFromSolcAST } from "../../../readers";

function generatePackedTypeLibraries(
  typeDefinition: StructDefinition | undefined,
  type: StructType | ArrayType,
  sourceUnit: WrappedSourceUnit,
  gasToCodePreferenceRatio = 3,
  defaultSelectionForSameScore: "leastgas" | "leastcode" = "leastgas",
  withStack = false,
  withMemory = false
) {
  const stackSourceUnit = withStack
    ? WrappedSourceUnit.getWrapper(sourceUnit.helper, `${NameGen.packedStackType(type)}.sol`)
    : undefined;
  const memorySourceUnit = sourceUnit; /*  withMemory
    ? WrappedSourceUnit.getWrapper(sourceUnit.helper, `${NameGen.packedMemoryType(type)}.sol`)
    : undefined; */
  if (withStack) {
    if (withMemory) {
      stackSourceUnit!.addImports(memorySourceUnit!.sourceUnit!);
    }
    PackedStackTypeGenerator.fromStruct(
      typeDefinition,
      type,
      stackSourceUnit!,
      gasToCodePreferenceRatio,
      defaultSelectionForSameScore,
      withMemory
    );
  }
  if (withMemory) {
    if (withStack) {
      memorySourceUnit!.addImports(stackSourceUnit!.sourceUnit!);
    }
    PackedMemoryTypeGenerator.fromStruct(
      typeDefinition,
      type,
      memorySourceUnit!,
      gasToCodePreferenceRatio,
      defaultSelectionForSameScore
    );
  }
  stackSourceUnit?.applyPendingFunctions();
  memorySourceUnit?.applyPendingFunctions();

  return { stackSourceUnit, memorySourceUnit };
}

async function test() {
  const h = await CompileHelper.fromFiles(
    new Map([
      [
        "OldMarketState.sol",
        `struct RoleProvider {
               uint32 roleTimeToLive;
               address providerAddress;
               uint24 pullProviderIndex;
             }`
      ]
    ]),
    `OldMarketState.sol`
  );
  const sourceUnit = WrappedSourceUnit.getWrapper(h, h.getSourceUnit("OldMarketState.sol"));
  const typeDefinition = sourceUnit.scope.getChildrenByType(StructDefinition)[0];
  const type = readTypeNodesFromSolcAST(false, sourceUnit.scope).structs[0] as StructType;
  const { memorySourceUnit, stackSourceUnit } = generatePackedTypeLibraries(
    typeDefinition,
    type,
    sourceUnit,
    undefined,
    undefined,
    true,
    true
  );
  console.log(memorySourceUnit?.outputPath);
  console.log(stackSourceUnit?.outputPath);

  //   await generator.ctx.applyPendingFunctions();
  //   const codeOut = new ASTWriter(
  //     DefaultASTWriterMapping,
  //     new PrettyFormatter(2),
  //     LatestCompilerVersion
  //   ).write(generator.ctx.sourceUnit);
  //   console.log(codeOut);
  //   writeFileSync(path.join(__dirname, memorySourceUnit?.sourceUnit.absolutePath), codeOut);
}

test();
