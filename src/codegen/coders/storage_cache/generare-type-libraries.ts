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
import { CompileHelper } from "../../../utils/compile_utils/compile_helper";
import { readTypeNodesFromSolcAST } from "../../../readers";
import { writeFileSync } from "fs";
import path from "path";

export type PackedTypeLibraryOptions = {
  gasToCodePreferenceRatio?: number;
  defaultSelectionForSameScore?: "leastgas" | "leastcode";
  withStack?: boolean;
  withMemory?: boolean;
};

function generatePackedTypeLibraries(
  typeDefinition: StructDefinition | undefined,
  type: StructType | ArrayType,
  sourceUnit: WrappedSourceUnit,
  {
    gasToCodePreferenceRatio = 3,
    defaultSelectionForSameScore = "leastgas",
    withStack = false,
    withMemory = false
  }: PackedTypeLibraryOptions
) {
  const stackSourceUnit = withStack
    ? WrappedSourceUnit.getWrapper(sourceUnit.helper, `${NameGen.packedStackType(type)}.sol`)
    : undefined;
  const memorySourceUnit = sourceUnit;
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
        `/// @param useDepositHook Whether to call hook contract for deposit
        /// @param useRequestWithdrawalHook Whether to call hook contract for requestWithdrawal
        /// @param useExecuteWithdrawalHook Whether to call hook contract for executeWithdrawal
        /// @param useTransferHook Whether to call hook contract for transfer
        /// @param useBorrowHook Whether to call hook contract for borrow
        /// @param useRepayHook Whether to call hook contract for repay
        /// @param useCloseMarketHook Whether to call hook contract for closeMarket
        /// @param useAssetsSentToEscrowHook Whether to call hook contract when account sanctioned
        struct MarketHookFlags {
            bool useDepositHook;
            bool useRequestWithdrawalHook;
            bool useExecuteWithdrawalHook;
            bool useTransferHook;
            bool useBorrowHook;
            bool useRepayHook;
            bool useCloseMarketHook;
            bool useAssetsSentToEscrowHook;
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
    { withMemory: false, withStack: true }
  );
  console.log(memorySourceUnit?.outputPath);
  console.log(stackSourceUnit?.outputPath);

  const codeOut = new ASTWriter(
    DefaultASTWriterMapping,
    new PrettyFormatter(2),
    LatestCompilerVersion
  ).write(stackSourceUnit!.sourceUnit);
  writeFileSync(path.join(__dirname, "NewMarketState.sol"), codeOut);
}

test();
