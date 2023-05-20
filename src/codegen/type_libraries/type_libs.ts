import { DataLocation } from "solc-typed-ast";
import { ArrayType, DefaultVisitor, TypeNode } from "../../ast";
import NameGen from "../names";
import { CodegenContext, ContractCodegenContext } from "../utils";

type TypeLibraryOptions = {
  calldataCast: boolean;
  memoryCast: boolean;
  arrayHelpers: boolean;
};

/* export class TypeLibraryGenerator extends DefaultVisitor {
  constructor(public ctx: CodegenContext, public options: TypeLibraryOptions) {
    super();
  }


} */

function pointerCastFunction(ctx: ContractCodegenContext, type: TypeNode, location: DataLocation) {
  const typeCastFunction = NameGen.castToPointer(type, location);
  const ptr = location === DataLocation.Memory ? "MemoryPointer" : "CalldataPointer";
  const parameter = type.writeParameter(location, "item");
  return ctx.addFunction(typeCastFunction, [
    `function ${typeCastFunction}(${parameter}) internal pure returns (${ptr} ptr) {`,
    [`assembly {`, [`ptr := item`], `}`],
    `}`
  ]);
}

function addPointerCasts(ctx: ContractCodegenContext, type: TypeNode, options: TypeLibraryOptions) {
  const castParams: Array<[TypeNode, DataLocation]> = [];
  if (options.memoryCast) {
    castParams.push([type, DataLocation.Memory]);
  }
  if (options.calldataCast) {
    castParams.push([type, DataLocation.CallData]);
  }
  if (options.arrayHelpers) {
    const arr = new ArrayType(type, undefined);
    if (options.memoryCast) {
      castParams.push([arr, DataLocation.Memory]);
    }
    if (options.calldataCast) {
      castParams.push([arr, DataLocation.CallData]);
    }
  }
  castParams.forEach(([type, location]) => pointerCastFunction(ctx, type, location));
}

function generateTypeLibrary(
  ctx: ContractCodegenContext,
  type: TypeNode,
  options: TypeLibraryOptions
) {
  addPointerCasts(ctx, type, options);
}
