import path from "path";
import {
  ContractDefinition,
  ContractKind,
  Mapping,
  staticNodeFactory,
  StructDefinition
} from "solc-typed-ast";
import { structDefinitionToTypeNode } from "../readers";
import { addImports, coerceArray, CompileHelper, Logger, NoopLogger } from "../utils";

import { getForgeJsonSerializeFunction } from "./serialize/forge_json";
import { CodegenContext } from "./utils";
import { getForgeAssertEqualityFunction } from "./serialize/forge_assert";
import { getLibJson, getSTDAssertionsShim } from "./solidity_libraries";

export { addExternalWrappers, upgradeSourceCoders } from "./coders/generate";
export { generateJsonSerializers } from "./serialize/generate";

type CoderOptions = {
  functionSwitch: boolean;
  decoderFileName?: string;
  outPath?: string;
};

const defaultOptions: CoderOptions = {
  functionSwitch: true
};

export function generateSerializers(
  helper: CompileHelper,
  fileName: string,
  options: CoderOptions = defaultOptions,
  struct?: string | string[],
  logger: Logger = new NoopLogger()
): void {
  const serializerFileName = options.decoderFileName ?? fileName.replace(".sol", "Serializers.sol");
  const ctx = new CodegenContext(helper, serializerFileName);
  const sourceUnit = helper.getSourceUnit(fileName);
  const vmName = options.outPath ? path.join(options.outPath, `LibJson.sol`) : `LibJson.sol`;
  const libJson = helper.addSourceUnit(vmName, getLibJson());
  addImports(ctx.decoderSourceUnit, libJson, []);
  addImports(ctx.decoderSourceUnit, sourceUnit, []);
  let structDefinitions = sourceUnit
    .getChildrenByType(StructDefinition)
    .filter((struct) => struct.getChildrenByType(Mapping).length === 0);
  if (struct) {
    structDefinitions = structDefinitions.filter((s) => coerceArray(struct).includes(s.name));
  }

  const structs = structDefinitions.map(structDefinitionToTypeNode);
  for (const struct of structs) {
    getForgeJsonSerializeFunction(ctx, struct);
  }
  ctx.applyPendingFunctions();
}

export function generateAssertions(
  helper: CompileHelper,
  fileName: string,
  options: CoderOptions = defaultOptions,
  struct?: string | string[],
  logger: Logger = new NoopLogger()
): void {
  const serializerFileName = options.decoderFileName ?? fileName.replace(".sol", "Assertions.sol");
  const ctx = new CodegenContext(helper, serializerFileName);

  const sourceUnit = helper.getSourceUnit(fileName);
  const vmName = options.outPath ? path.join(options.outPath, `Tmp_Assert.sol`) : `Tmp_Assert.sol`;
  const vm = helper.addSourceUnit(vmName, getSTDAssertionsShim());
  addImports(ctx.decoderSourceUnit, vm, []);
  addImports(ctx.decoderSourceUnit, sourceUnit, []);
  const lib = ctx.addContract("Assertions", ContractKind.Contract, [
    vm.getChildrenByType(ContractDefinition).find((c) => c.name === "StdAssertions")?.id as number
  ]);
  ctx.addCustomTypeUsingForDirective(
    "uint256",
    staticNodeFactory.makeIdentifierPath(
      sourceUnit.requiredContext,
      "LibString",
      vm.getChildrenByType(ContractDefinition).find((c) => c.name === "LibString")?.id as number
    ),
    undefined,
    false
  );
  let structDefinitions = sourceUnit
    .getChildrenByType(StructDefinition)
    .filter((struct) => struct.getChildrenByType(Mapping).length === 0);
  if (struct) {
    structDefinitions = structDefinitions.filter((s) => coerceArray(struct).includes(s.name));
  }

  const structs = structDefinitions.map(structDefinitionToTypeNode);
  for (const struct of structs) {
    getForgeAssertEqualityFunction(lib, struct);
  }
  lib.applyPendingFunctions();
  ctx.applyPendingContracts();
}
