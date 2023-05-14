import path from "path";
import {
  ContractDefinition,
  ContractKind,
  Mapping,
  SourceUnit,
  staticNodeFactory,
  StructDefinition
} from "solc-typed-ast";
import { structDefinitionToTypeNode } from "../readers";
import { addImports, coerceArray, CompileHelper, Logger, NoopLogger } from "../utils";
import {
  buildDecoderFile,
  buildExternalWrapper,
  replaceExternalFunctionReferenceTypeParameters
} from "./abi_decode";
import { getForgeJsonSerializeFunction } from "./serialize/forge_json";
import { getFunctionSelectorSwitch } from "./function_switch";
import { CodegenContext } from "./utils";
import { getForgeAssertEqualityFunction } from "./serialize/forge_assert";
import { getSTDAssertionsShim, getVMShim } from "./solidity_libraries";

type CoderOptions = {
  functionSwitch: boolean;
  decoderFileName?: string;
  outPath?: string;
};

const defaultOptions: CoderOptions = {
  functionSwitch: true
};

export function upgradeSourceCoders(
  helper: CompileHelper,
  fileName: string,
  options: CoderOptions = defaultOptions,
  logger: Logger = new NoopLogger()
): void {
  const decoderFileName = options.decoderFileName ?? fileName.replace(".sol", "Decoder.sol");
  let decoderSourceUnit: SourceUnit;
  if (helper.hasSourceUnit(decoderFileName)) {
    decoderSourceUnit = helper.getSourceUnit(decoderFileName);
  } else {
    logger.log(`generating decoders for ${fileName}...`);
    const ctx = buildDecoderFile(helper, fileName, decoderFileName, options.functionSwitch);
    decoderSourceUnit = ctx.decoderSourceUnit;
  }
  const sourceUnit = helper.getSourceUnit(fileName);
  logger.log(`replacing parameter declarations in ${fileName}...`);
  replaceExternalFunctionReferenceTypeParameters(sourceUnit, decoderSourceUnit);
  const contractDefinition = sourceUnit.getChildrenByType(ContractDefinition)[0];

  if (!contractDefinition) {
    throw Error(`No contracts found in ${fileName}`);
  }

  if (options.functionSwitch) {
    logger.log(`generating function switch for ${contractDefinition.name}...`);
    getFunctionSelectorSwitch(contractDefinition, decoderSourceUnit);
  }
}

export function addExternalWrappers(
  helper: CompileHelper,
  fileName: string,
  logger: Logger = new NoopLogger()
): void {
  const decoderFileName = fileName.replace(".sol", "External.sol");

  logger.log(`generating wrappers for ${fileName}...`);
  const ctx = buildExternalWrapper(helper, fileName, decoderFileName);
}
/* 

address constant VM_ADDRESS = address(uint160(uint256(keccak256("hevm cheat code"))));
IVm constant vm = IVm(VM_ADDRESS); */
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
  const vmName = options.outPath ? path.join(options.outPath, `Temp___Vm.sol`) : `Temp___Vm.sol`;
  const vm = helper.addSourceUnit(vmName, getVMShim());
  addImports(ctx.decoderSourceUnit, vm, []);
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
