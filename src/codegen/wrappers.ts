import {
  ContractDefinition,
  ContractKind,
  FunctionDefinition,
  FunctionKind,
  FunctionVisibility,
  Identifier
} from "solc-typed-ast";
import { WrappedSourceUnit } from "./ctx/contract_wrapper";
import { getParentSourceUnit, makeFunctionCallFor } from "../utils";

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
  for (const fn of functions) {
    const inDifferentSourceUnit = getParentSourceUnit(fn) !== outputSourceUnit.scope;
    if (inDifferentSourceUnit) {
      functionsToImport.push(fn);
      importAliases.push(fn.vScope.type === "SourceUnit" ? `_internal_${fn.name}` : undefined);
    }
    // @todo why is .vScope sometimes a VariableDeclaration?
    // maybe an issue with recompile?
    if (fn.parent instanceof ContractDefinition && fn.parent.kind === ContractKind.Library) {
      fnIdentifiers.push(`${fn.parent.name}.${fn.name}`);
    } else {
      if (fn.vScope.type === "SourceUnit" && inDifferentSourceUnit) {
        fnIdentifiers.push(`_internal_${fn.name}`);
      } else {
        fnIdentifiers.push(fn.name);
      }
    }
  }

  // console.log(importAliases);
  // console.log(fnIdentifiers);
  outputSourceUnit.addDependencyImports(functionsToImport);
  outputSourceUnit.addFunctionImports(functionsToImport, importAliases as any);

  // const aliases = functions.map((fn) =>
  //   fn.vScope.type === "SourceUnit" ? `_internal_${fn.name}` : undefined
  // );
  // outputSourceUnit.addFunctionImports(functions, aliases as any);
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
    (fnCall.vExpression as Identifier).name = fnIdentifiers[i] as string;
    /* if (fn.vScope.type === "ContractDefinition" && fn.vScope.kind === ContractKind.Library) {
      (fnCall.vExpression as Identifier).name = `${fn.vScope.name}.${fn.name}`;
    } else {
      (fnCall.vExpression as Identifier).name = fnIdentifiers[i] as string;
      console.log(`name is ${aliases[i]}`);
    } */
    copy.vBody = factory.makeBlock([]);
    if (copy.vReturnParameters.vParameters.length) {
      copy.vBody.appendChild(factory.makeReturn(copy.vReturnParameters.vParameters.length, fnCall));
    } else {
      copy.vBody.appendChild(factory.makeExpressionStatement(fnCall));
    }
  });
}
