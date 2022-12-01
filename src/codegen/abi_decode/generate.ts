import { FunctionDefinition } from "solc-typed-ast";
import { TypeNode } from "../../ast";
import { functionDefinitionToTypeNode } from "../../readers";
import { addDependencyImports, CompileHelper, TypeExtractor } from "../../utils";
import { CodegenContext } from "../utils";
import { abiDecodingFunction } from "./abi_decode";
import { getExternalFunctionsWithReferenceTypeParameters } from "./function_editor";
import { typeCastAbiDecodingFunction } from "./type_cast";

export function buildDecoderFile(
  helper: CompileHelper,
  primaryFileName: string,
  decoderFileName = primaryFileName.replace(".sol", "Decoder.sol")
): CodegenContext {
  const ctx = new CodegenContext(helper, decoderFileName);
  const sourceUnit = helper.getSourceUnit(primaryFileName);
  const functions = getExternalFunctionsWithReferenceTypeParameters(
    sourceUnit.getChildrenByType(FunctionDefinition)
  );
  addDependencyImports(ctx.decoderSourceUnit, functions);
  const functionTypes = functions.map(functionDefinitionToTypeNode);
  addTypeDecoders(ctx, [...functionTypes]);
  ctx.applyPendingFunctions();
  return ctx;
}

export function addTypeDecoders(ctx: CodegenContext, inputTypes: TypeNode[]): void {
  const { types, functionParameters } = TypeExtractor.extractCoderTypes(inputTypes);

  for (const type of types) {
    abiDecodingFunction(ctx, type);
  }
  for (const type of functionParameters) {
    typeCastAbiDecodingFunction(ctx, type);
  }
}
