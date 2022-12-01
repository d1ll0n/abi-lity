import { ContractDefinition, SourceUnit } from "solc-typed-ast";
import { CompileHelper, Logger, NoopLogger } from "../utils";
import { buildDecoderFile, replaceExternalFunctionReferenceTypeParameters } from "./abi_decode";
import { getFunctionSelectorSwitch } from "./function_switch";

type CoderOptions = {
  functionSwitch: boolean;
  decoderFileName?: string;
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
    const ctx = buildDecoderFile(helper, fileName, decoderFileName);
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
