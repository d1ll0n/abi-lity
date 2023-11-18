import { DataLocation, FunctionStateMutability } from "solc-typed-ast";
import { ArrayType, DefaultVisitor, TypeNode } from "../../ast";
import NameGen from "../names";
import { WrappedScope } from "../ctx/contract_wrapper";

export type TypeLibraryOptions = {
  calldataCast?: boolean;
  memoryCast?: boolean;
  arrayCast?: boolean;
  singletonCast?: boolean;
};

function addPointerCastFunction(ctx: WrappedScope, type: TypeNode, location: DataLocation) {
  const fnName = NameGen.castToPointer(type, location);
  const ptr = location === DataLocation.Memory ? "MemoryPointer" : "CalldataPointer";
  const parameter = type.writeParameter(location, "item");
  ctx.addInternalFunction(
    fnName,
    parameter,
    `${ptr} ptr`,
    [`assembly {`, [`ptr := item`], `}`],
    FunctionStateMutability.Pure
  );
}

export function generatePointerCastFunctions(
  ctx: WrappedScope,
  type: TypeNode,
  options: TypeLibraryOptions
): void {
  const castParams: Array<[TypeNode, DataLocation]> = [];
  if (options.singletonCast) {
    if (options.memoryCast) {
      castParams.push([type, DataLocation.Memory]);
    }
    if (options.calldataCast) {
      castParams.push([type, DataLocation.CallData]);
    }
  }
  if (options.arrayCast) {
    const arr = new ArrayType(type, undefined);
    if (options.memoryCast) {
      castParams.push([arr, DataLocation.Memory]);
    }
    if (options.calldataCast) {
      castParams.push([arr, DataLocation.CallData]);
    }
  }
  castParams.forEach(([type, location]) => addPointerCastFunction(ctx, type, location));
}
