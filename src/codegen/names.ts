import { DataLocation } from "solc-typed-ast";
import { TupleType, TypeNode } from "../ast";

export const NameGen = {
  abiDecode: (type: TypeNode): string => `abi_decode_${type.identifier}`,
  return: (type: TypeNode): string => `return_${type.identifier}`,
  typeCast: (type: TypeNode): string => {
    const typeName =
      type instanceof TupleType
        ? type.vMembers.length > 1
          ? type.identifier
          : type.vMembers[0].identifier
        : type.identifier;
    return `to_${typeName}_ReturnType`;
  },
  structMemberOffset: (type: TypeNode, location: DataLocation): string => {
    const parent = type.parent;
    if (!parent) {
      throw Error(`Can not get struct member offset for type with no parent`);
    }
    const prefix = `${parent.identifier}_${type.labelFromParent}`;
    let middle = "";
    if (type.calldataHeadOffset !== type.memoryHeadOffset) {
      middle = location === DataLocation.CallData ? "_cd" : "_mem";
    }
    return `${prefix}${middle}_offset`;
  }
};

export default NameGen;
