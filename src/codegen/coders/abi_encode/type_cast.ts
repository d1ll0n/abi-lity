import { TypeNode } from "../../../ast";
import NameGen from "../../names";
import { WrappedScope } from "../../ctx/contract_wrapper";
import { FunctionStateMutability } from "solc-typed-ast";

export function typeCastFunction(
  ctx: WrappedScope,
  type: TypeNode,
  parameters: string,
  returnParameters: string,
  usingParameters: string,
  usingReturnParameters: string
): string {
  const name =
    parameters !== usingParameters ? NameGen.castInputType(type) : NameGen.castReturnType(type);
  if (ctx.hasFunction(name)) {
    return name;
  }

  const inputReturns = returnParameters.length > 0 ? `returns (${returnParameters}) ` : "";
  const usingReturns =
    usingReturnParameters.length > 0 ? `returns (${usingReturnParameters}) ` : "";
  const inputParam = `function (${parameters}) internal pure ${inputReturns}inFn`;
  const outputParam = `function (${usingParameters}) internal pure ${usingReturns}outFn`;
  const body = [`assembly {`, [`outFn := inFn`], `}`];
  return ctx.addInternalFunction(name, inputParam, outputParam, body, FunctionStateMutability.Pure);
}
