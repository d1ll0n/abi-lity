import { DataLocation, FunctionStateMutability } from "solc-typed-ast";
import { TupleType, TypeNode } from "../../../ast";
import NameGen from "../../names";
import { WrappedScope } from "../../ctx/contract_wrapper";

export function typeCastAbiDecodingFunction(ctx: WrappedScope, type: TypeNode): string {
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
  const body = [`assembly {`, [`outFn := inFn`], `}`];
  return ctx.addInternalFunction(name, inputParam, outputParam, body, FunctionStateMutability.Pure);
}
