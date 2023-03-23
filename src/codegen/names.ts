import { TupleType, TypeNode } from "../ast";
import { EncodingScheme } from "../constants";

export const NameGen = {
  abiDecode: (type: TypeNode): string =>
    `abi_decode_${type.identifier === "string" ? "bytes" : type.identifier}`,
  abiEncode: (type: TypeNode): string =>
    `abi_encode_${type.identifier === "string" ? "bytes" : type.identifier}`,
  getField: (type: TypeNode): string => `get${type.pascalCaseName}`,
  // Prefix for constants associated with a member of a struct
  structMemberPrefix: (type: TypeNode): string => {
    const parent = type.parent;
    if (!parent) {
      throw Error(`Can not get struct member offset for type with no parent`);
    }
    return `${parent.identifier}_${type.labelFromParent}`;
  },
  bitsAfter: (type: TypeNode): string => {
    const prefix = NameGen.structMemberPrefix(type);
    return `${prefix}_trailing_bits`;
  },
  bitsOffset: (type: TypeNode): string => {
    const prefix = NameGen.structMemberPrefix(type);
    return `${prefix}_offset_bits`;
  },
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

  structMemberSize: (type: TypeNode, encoding?: EncodingScheme): string => {
    const prefix = NameGen.structMemberPrefix(type);
    let middle = "";
    if (
      encoding !== undefined &&
      [EncodingScheme.ABI, EncodingScheme.SolidityMemory].includes(encoding)
    ) {
      middle = encoding === EncodingScheme.ABI ? "_abi" : "_mem";
    } else if (encoding === EncodingScheme.SuperPacked) {
      middle = "_bits";
    }
    return `${prefix}${middle}_size`;
  },
  structMemberOffset: (type: TypeNode, encoding: EncodingScheme): string => {
    const prefix = NameGen.structMemberPrefix(type);
    let middle = "";
    if (
      type.calldataHeadOffset !== type.memoryHeadOffset &&
      [EncodingScheme.ABI, EncodingScheme.SolidityMemory].includes(encoding)
    ) {
      middle = encoding === EncodingScheme.ABI ? "_abi" : "_mem";
    }
    if (encoding === EncodingScheme.SuperPacked) {
      middle = "_bits";
    }
    return `${prefix}${middle}_offset`;
  }
};

export function snakeCaseToPascalCase(str: string): string {
  str = str.replace(/(_\w)/g, (m) => {
    return m[1].toUpperCase();
  });
  return str[0].toUpperCase().concat(str.slice(1));
}

export function snakeCaseToCamelCase(str: string): string {
  return pascalCaseToCamelCase(snakeCaseToPascalCase(str));
}

export function pascalCaseToCamelCase(str: string): string {
  return str[0].toLowerCase().concat(str.slice(1));
}

export default NameGen;
