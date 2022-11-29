import { DataLocation } from "solc-typed-ast";
import { TupleType, TypeNode } from "../ast";
import { writeNestedStructure } from "../utils";

export function typeCastAbiDecodingFunction(type: TypeNode): { code: string; name: string } {
  const params =
    type instanceof TupleType
      ? type.vMembers.map(() => `MemoryPointer`).join(", ")
      : "MemoryPointer";
  const inputParam = `function (CalldataPointer) internal pure returns (${params}) inFn`;
  const outputParam = `function (CalldataPointer) internal pure returns (${type.writeParameter(
    DataLocation.Memory,
    ""
  )}) outFn`;
  const name = `to_${type.identifier}_ReturnType`;
  const code = writeNestedStructure([
    `function ${name} (`,
    [inputParam],
    `) pure returns (${outputParam}) {`,
    [`assembly {`, [`outFn := inFn`], `}`],
    `}`
  ]);
  return {
    name,
    code
  };
}
