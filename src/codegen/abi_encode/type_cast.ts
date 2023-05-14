import { TypeNode } from "../../ast";
import { writeNestedStructure } from "../../utils";
import NameGen from "../names";
import { CodegenContext } from "../utils";

export function typeCastFunction(
  ctx: CodegenContext,
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
  const code = writeNestedStructure([
    `function ${name} (`,
    [inputParam],
    `) pure returns (${outputParam}) {`,
    [`assembly {`, [`outFn := inFn`], `}`],
    `}`
  ]);
  ctx.addFunction(name, code);
  return name;
}
