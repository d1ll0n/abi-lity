import { TypeNode } from "../../ast";
import { writeNestedStructure } from "../../utils";
import NameGen from "../names";
import { CodegenContext } from "../utils";

/**
 * Generates a function that casts between two function pointer types using inline assembly.
 * Used to adapt encoding functions with different parameter/return signatures so they can
 * be called through a common interface (e.g. casting `(uint256) → ()` to `(bytes32) → ()`).
 */
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
