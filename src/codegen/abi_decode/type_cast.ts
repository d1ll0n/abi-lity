import { DataLocation } from "solc-typed-ast";
import { TupleType, TypeNode } from "../../ast";
import { writeNestedStructure } from "../../utils";
import NameGen from "../names";
import { CodegenContext } from "../utils";

export function typeCastAbiDecodingFunction(ctx: CodegenContext, type: TypeNode): string {
  const name = NameGen.castReturnType(type);
  if (ctx.hasFunction(name)) {
    return name;
  }

  const params =
    type instanceof TupleType
      ? type.vMembers.map(() => `MemoryPointer`).join(", ")
      : "MemoryPointer";
  const outParams =
    type instanceof TupleType
      ? type.vMembers.map((m) => m.writeParameter(DataLocation.Memory, "")).join(", ")
      : type.writeParameter(DataLocation.Memory, "");
  const inputParam = `function (CalldataPointer) internal pure returns (${params}) inFn`;
  const outputParam = `function (CalldataPointer) internal pure returns (${outParams}) outFn`;
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
