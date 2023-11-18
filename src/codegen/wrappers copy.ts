import {
  ASTNodeFactory,
  ContractKind,
  FunctionDefinition,
  FunctionKind,
  FunctionVisibility,
  Identifier,
  ScopeNode
} from "solc-typed-ast";
import { CompileHelper } from "../utils/compile_utils/compile_helper";
import { WrappedScope, WrappedSourceUnit } from "./ctx/contract_wrapper";
import { addFunctionImports, getParentSourceUnit, makeFunctionCallFor } from "../utils";

// @todo make better fn to derive reference to fn
// should be able to make:
// - MemberAccess if fn member of a library which is not same scope as call context
// - identifier if fn is in scope (source unit, contract, parent contract)
// - identifier to import directive if fn is in another file

export function buildExternalWrapper(
  outputSourceUnit: WrappedSourceUnit,
  functions: FunctionDefinition[]
): void {
  const functionsToImport: FunctionDefinition[] = [];
  const importAliases: Array<string | undefined> = [];
  const fnIdentifiers: string[] = [];

  /*   for (const fn of functions) {
    const inDifferentSourceUnit = getParentSourceUnit(fn) !== outputSourceUnit.scope;
    if (inDifferentSourceUnit) {
      functionsToImport.push(fn);
      // if (fn.vScope.type === "SourceUnit")
      importAliases.push(fn.vScope.type === "SourceUnit" ? `_internal_${fn.name}` : undefined);
    }
    if (fn.vScope.type === "ContractDefinition" && fn.vScope.kind === ContractKind.Library) {
      fnIdentifiers.push(`${fn.vScope.name}.${fn.name}`);
    } else {
      if (fn.vScope.type === "SourceUnit" && inDifferentSourceUnit) {
        fnIdentifiers.push(`_internal_${fn.name}`);
      } else {
        fnIdentifiers.push(fn.name);
      }
    }
  }
  if (functionsToImport.length > 0) {
    outputSourceUnit.addDependencyImports(functions);
    outputSourceUnit.addFunctionImports(functionsToImport, importAliases as any);
  } */

  const aliases = functions.map((fn) =>
    fn.vScope.type === "SourceUnit" ? `_internal_${fn.name}` : undefined
  );
  // console.log(functions.map((fn) => fn.vScope).filter(Boolean).length);
  outputSourceUnit.addDependencyImports(functions);
  outputSourceUnit.addFunctionImports(functions, aliases as any);
  const contract = outputSourceUnit.addContract("ExternalWrapper", ContractKind.Contract).scope;
  const factory = outputSourceUnit.factory;

  functions.forEach((fn, i) => {
    const copy = factory.copy(fn);
    contract.appendChild(copy);
    copy.vScope = contract;
    copy.visibility = FunctionVisibility.External;
    copy.kind = FunctionKind.Function;

    const args = copy.vParameters.vParameters.map((param) => factory.makeIdentifierFor(param));
    const fnCall = makeFunctionCallFor(fn, args);
    // (fnCall.vExpression as Identifier).name = fnIdentifiers[i];
    if (fn.vScope.type === "ContractDefinition" && fn.vScope.kind === ContractKind.Library) {
      (fnCall.vExpression as Identifier).name = `${fn.vScope.name}.${fn.name}`;
    } else {
      (fnCall.vExpression as Identifier).name = aliases[i] as string;
    }
    copy.vBody = factory.makeBlock([]);
    if (copy.vReturnParameters.vParameters.length) {
      copy.vBody.appendChild(factory.makeReturn(copy.vReturnParameters.vParameters.length, fnCall));
    } else {
      copy.vBody.appendChild(factory.makeExpressionStatement(fnCall));
    }
  });
}

/* export function buildExternalWrapper(
  helper: CompileHelper,
  primaryFileName: string,
  externalFileName = primaryFileName.replace(".sol", "Decoder.sol"),
  outputPath?: string
): CodegenContext {
  const ctx = WrappedSourceUnit.getWrapper(helper, primaryFileName);
  const sourceUnit = helper.getSourceUnit(primaryFileName);
  const functions = sourceUnit
    .getChildrenByType(FunctionDefinition)
    .filter(
      (fn) =>
        (fn.vScope.type === "SourceUnit" ||
          (fn.vScope.type === "ContractDefinition" && fn.vScope.kind === ContractKind.Library)) &&
        !isExternalFunction(fn)
    );
  addDependencyImports(ctx.decoderSourceUnit, functions);
  const aliases = functions.map((fn) =>
    fn.vScope.type === "SourceUnit" ? `_internal_${fn.name}` : undefined
  );
  addFunctionImports(ctx.decoderSourceUnit, functions, aliases as any);
  const contract = staticNodeFactory.makeContractDefinition(
    sourceUnit.requiredContext,
    `ExternalWrapper`,
    sourceUnit.id,
    ContractKind.Contract,
    false,
    true,
    [],
    []
  );
  const factory = new ASTNodeFactory(sourceUnit.requiredContext);
  functions.forEach((fn, i) => {
    const copy = factory.copy(fn);
    contract.appendChild(copy);
    copy.vScope = contract;
    copy.visibility = FunctionVisibility.External;
    copy.kind = FunctionKind.Function;

    const args = copy.vParameters.vParameters.map((param) => factory.makeIdentifierFor(param));
    const fnCall = makeFunctionCallFor(fn, args);
    if (fn.vScope.type === "ContractDefinition" && fn.vScope.kind === ContractKind.Library) {
      (fnCall.vExpression as Identifier).name = `${fn.vScope.name}.${fn.name}`;
    } else {
      (fnCall.vExpression as Identifier).name = aliases[i] as string;
    }
    copy.vBody = factory.makeBlock([]);
    if (copy.vReturnParameters.vParameters.length) {
      copy.vBody.appendChild(factory.makeReturn(copy.vReturnParameters.vParameters.length, fnCall));
    } else {
      copy.vBody.appendChild(factory.makeExpressionStatement(fnCall));
    }
  });
  ctx.decoderSourceUnit.appendChild(contract);
  return ctx;
}
 */
