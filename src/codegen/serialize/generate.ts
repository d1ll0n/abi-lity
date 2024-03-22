import { CompileHelper } from "../../utils/compile_utils/compile_helper";
import { coerceArray, Logger, NoopLogger } from "../../utils";

import { WrappedScope, WrappedSourceUnit } from "../ctx/contract_wrapper";
import { getLibJson } from "../solidity_libraries";
import { Mapping, StructDefinition } from "solc-typed-ast";
import { structDefinitionToTypeNode } from "../../readers/read_solc_ast";
import { getForgeJsonSerializeFunction } from "./json";

type CoderOptions = {
  decoderFileName?: string;
  outPath?: string;
};

const defaultOptions: CoderOptions = {};

export function generateJsonSerializers(
  helper: CompileHelper,
  fileName: string,
  options: CoderOptions = defaultOptions,
  struct?: string | string[],
  logger: Logger = new NoopLogger()
): void {
  const serializerFileName = options.decoderFileName ?? fileName.replace(".sol", "Serializers.sol");
  const ctx: WrappedScope = WrappedSourceUnit.getWrapper(
    helper,
    serializerFileName,
    options.outPath
  );
  // const ctx = new Wrapp(helper, serializerFileName);
  const sourceUnit = helper.getSourceUnit(fileName);
  const libJson = ctx.addSourceUnit("LibJson.sol", getLibJson());
  ctx.addImports(sourceUnit);
  ctx.addImports(libJson);
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
