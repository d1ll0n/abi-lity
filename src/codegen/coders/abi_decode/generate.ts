import { ContractKind, FunctionDefinition } from "solc-typed-ast";
import { TypeNode } from "../../../ast";
import { functionDefinitionToTypeNode } from "../../../readers";
import { TypeExtractor, isExternalFunction } from "../../../utils";
import { CompileHelper } from "../../../utils/compile_utils/compile_helper";
import { abiDecodingFunction } from "./abi_decode";
import { typeCastAbiDecodingFunction } from "./type_cast";
import { WrappedScope, WrappedSourceUnit } from "../../ctx/contract_wrapper";

export type GenerateDecoderOptions = {
  outputPath?: string;
  outputToLibrary?: boolean;
  generateTypeDecoders?: boolean;
};

export function buildDecoderFile(
  helper: CompileHelper,
  primaryFileName: string,
  decoderFileName = primaryFileName.replace(".sol", "Decoder.sol"),
  { outputPath, outputToLibrary, generateTypeDecoders }: GenerateDecoderOptions
): WrappedScope {
  let ctx: WrappedScope = WrappedSourceUnit.getWrapper(helper, decoderFileName, outputPath);
  ctx.addPointerLibraries();
  if (outputToLibrary) {
    ctx = (ctx as WrappedSourceUnit).addContract(
      decoderFileName.replace(".sol", ""),
      ContractKind.Library
    );
  }
  const sourceUnit = helper.getSourceUnit(primaryFileName);
  const functions = sourceUnit.getChildrenBySelector(isExternalFunction) as FunctionDefinition[];

  ctx.addDependencyImports(functions);
  const functionTypes = functions.map(functionDefinitionToTypeNode);
  if (generateTypeDecoders) addTypeDecoders(ctx, [...functionTypes]);
  return ctx;
}

export function addTypeDecoders(ctx: WrappedScope, inputTypes: TypeNode[]): void {
  const { types, functionParameters } = TypeExtractor.extractCoderTypes(inputTypes);

  for (const type of types) {
    abiDecodingFunction(ctx, type);
  }
  for (const type of functionParameters) {
    typeCastAbiDecodingFunction(ctx, type);
  }
}

// export function buildExternalWrapper(
//   helper: CompileHelper,
//   primaryFileName: string,
//   externalFileName = primaryFileName.replace(".sol", "Decoder.sol")
// ): CodegenContext {
//   const ctx = new CodegenContext(helper, externalFileName);
//   const sourceUnit = helper.getSourceUnit(primaryFileName);
//   const functions = sourceUnit
//     .getChildrenByType(FunctionDefinition)
//     .filter(
//       (fn) =>
//         (fn.vScope.type === "SourceUnit" ||
//           (fn.vScope.type === "ContractDefinition" && fn.vScope.kind === ContractKind.Library)) &&
//         !isExternalFunction(fn)
//     );
//   addDependencyImports(ctx.decoderSourceUnit, functions);
//   const aliases = functions.map((fn) =>
//     fn.vScope.type === "SourceUnit" ? `_internal_${fn.name}` : undefined
//   );
//   addFunctionImports(ctx.decoderSourceUnit, functions, aliases as any);
//   const contract = staticNodeFactory.makeContractDefinition(
//     sourceUnit.requiredContext,
//     `ExternalWrapper`,
//     sourceUnit.id,
//     ContractKind.Contract,
//     false,
//     true,
//     [],
//     []
//   );
//   const factory = new ASTNodeFactory(sourceUnit.requiredContext);
//   functions.forEach((fn, i) => {
//     const copy = factory.copy(fn);
//     contract.appendChild(copy);
//     copy.vScope = contract;
//     copy.visibility = FunctionVisibility.External;
//     copy.kind = FunctionKind.Function;

//     const args = copy.vParameters.vParameters.map((param) => factory.makeIdentifierFor(param));
//     const fnCall = makeFunctionCallFor(fn, args);
//     if (fn.vScope.type === "ContractDefinition" && fn.vScope.kind === ContractKind.Library) {
//       (fnCall.vExpression as Identifier).name = `${fn.vScope.name}.${fn.name}`;
//     } else {
//       (fnCall.vExpression as Identifier).name = aliases[i] as string;
//     }
//     copy.vBody = factory.makeBlock([]);
//     if (copy.vReturnParameters.vParameters.length) {
//       copy.vBody.appendChild(factory.makeReturn(copy.vReturnParameters.vParameters.length, fnCall));
//     } else {
//       copy.vBody.appendChild(factory.makeExpressionStatement(fnCall));
//     }
//   });
//   ctx.decoderSourceUnit.appendChild(contract);
//   return ctx;
// }
