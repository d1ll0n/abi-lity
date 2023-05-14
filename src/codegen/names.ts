import { DataLocation, assert } from "solc-typed-ast";
import { ErrorType, EventType, FunctionType, TupleType, TypeNode } from "../ast";
import { EncodingScheme } from "../constants";

const unwrapTuple = (type: TypeNode): TypeNode => {
  if (
    type instanceof TupleType &&
    type.vMembers.length === 1 &&
    !type.vMembers[0].isDynamicallyEncoded
  ) {
    return type.vMembers[0];
  }
  return type;
};

export const NameGen = {
  abiDecode: (type: TypeNode): string => {
    type = unwrapTuple(type);
    return `abi_decode_${type.identifier === "string" ? "bytes" : type.identifier}`;
  },
  innerAbiDecode: (type: TypeNode): string => {
    return `_${NameGen.abiDecode(type)}`;
  },
  abiEncode: (type: TypeNode): string => {
    type = unwrapTuple(type);
    return `abi_encode_${type.identifier === "string" ? "bytes" : type.identifier}`;
  },
  innerAbiEncode: (type: TypeNode): string => {
    return `_${NameGen.abiEncode(type)}`;
  },
  getField: (type: TypeNode): string => `get${type.pascalCaseName}`,
  // Prefix for constants associated with a member of a struct
  structMemberPrefix: (type: TypeNode): string => {
    const parent = type.parent;
    if (!parent) {
      throw Error(`Can not get struct member offset for type with no parent`);
    }
    return `${parent.identifier}_${type.labelFromParent}`;
  },
  fixedSegment(type: TypeNode, index: number): string {
    return `${type.identifier}_fixed_segment_${index}`;
  },
  headSize: (type: TypeNode, encoding?: EncodingScheme): string => {
    let middle = "";
    if (
      encoding !== undefined &&
      [EncodingScheme.ABI, EncodingScheme.SolidityMemory].includes(encoding)
    ) {
      middle = encoding === EncodingScheme.ABI ? "_abi" : "_mem";
    } else if (encoding === EncodingScheme.SuperPacked) {
      middle = "_bits";
    }
    return `${type.identifier}${middle}_head_size`;
  },
  encodedSize: (type: TypeNode): string => {
    return `${type.identifier}_encoded_size`;
  },
  tailSize: (type: TypeNode, encoding?: EncodingScheme): string => {
    let middle = "";
    if (
      encoding !== undefined &&
      [EncodingScheme.ABI, EncodingScheme.SolidityMemory].includes(encoding)
    ) {
      middle = encoding === EncodingScheme.ABI ? "_abi" : "_mem";
    } else if (encoding === EncodingScheme.SuperPacked) {
      middle = "_bits";
    }
    return `${type.identifier}${middle}_tail_size`;
  },
  bitsAfter: (type: TypeNode): string => {
    const prefix = NameGen.structMemberPrefix(type);
    return `${prefix}_trailing_bits`;
  },
  bitsOffset: (type: TypeNode): string => {
    const prefix = NameGen.structMemberPrefix(type);
    return `${prefix}_offset_bits`;
  },
  typeLibrary: (type: TypeNode): string => {
    return `${type.pascalCaseName}Library`;
  },
  castToPointer: (type: TypeNode, location: DataLocation): string => {
    assert(
      location === DataLocation.CallData || location === DataLocation.Memory,
      `Can not cast to pointer for location: ${location}`
    );
    return `to${location === DataLocation.CallData ? "Calldata" : "Memory"}Pointer`;
  },
  hash: (type: TypeNode): string => {
    if (
      type instanceof TupleType &&
      type.vMembers.length === 1 &&
      !type.vMembers[0].isDynamicallyEncoded
    ) {
      type = type.vMembers[0];
    }
    return `hash_${type.identifier}`;
  },
  emit: (type: TypeNode): string => {
    if (
      type instanceof TupleType &&
      type.vMembers.length === 1 &&
      !type.vMembers[0].isDynamicallyEncoded
    ) {
      type = type.vMembers[0];
    }
    return `emit_${type.identifier}`;
  },
  return: (type: TypeNode): string => {
    if (
      type instanceof TupleType &&
      type.vMembers.length === 1 &&
      !type.vMembers[0].isDynamicallyEncoded
    ) {
      type = type.vMembers[0];
    }
    return `return_${type.identifier}`;
  },
  selector: (type: FunctionType | ErrorType): string => {
    return `${type.name}_selector`;
  },
  // castSignature = () => `castSignature`,
  castReturnType: (type: TypeNode): string => {
    const typeName =
      type instanceof TupleType
        ? type.vMembers.length > 1
          ? type.identifier
          : type.vMembers[0].identifier
        : type.identifier;
    const isPlural = type instanceof TupleType && type.vMembers.length > 1;
    return `with_${typeName}_ReturnParameter${isPlural ? "s" : ""}`;
  },
  castInputType: (type: TypeNode): string => {
    const typeName =
      type instanceof TupleType
        ? type.vMembers.length > 1
          ? type.identifier
          : type.vMembers[0].identifier
        : type.identifier;
    const isPlural = type instanceof TupleType && type.vMembers.length > 1;
    return `with_${typeName}_Parameter${isPlural ? "s" : ""}`;
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
  },
  functionParameterPrefix: (type: TypeNode, returnParameter: boolean): string => {
    const parent = type.parent?.parent;
    assert(
      parent instanceof FunctionType,
      `Can not get function parameter prefix for type with non-function grandparent`
    );
    const middle = returnParameter ? "_returnParameter" : "_parameter";
    return `${parent.name}${middle}_${type.labelFromParent}`;
  },
  functionParameterOffset: (type: TypeNode, returnParameter: boolean): string => {
    const prefix = NameGen.functionParameterPrefix(type, returnParameter);
    return `${prefix}_offset`;
  },
  parameterHeadSize: (
    type: FunctionType | ErrorType | EventType,
    returnParameter: boolean
  ): string => {
    const middle = returnParameter ? "_returnParameters" : "_parameters";
    return `${type.name}${middle}_head_size`;
  }
} as const;

export type NameGenParameters<K extends string> = K extends keyof typeof NameGen
  ? typeof NameGen[K] extends (...args: infer Args) => infer R
    ? Args extends any[]
      ? Args
      : []
    : []
  : [];

type AsRestArgs<Args> = Args extends any[] ? Args : [];

type AsRestFn<Obj extends { [K in keyof Obj]: any }, K extends keyof Obj> = Obj[K] extends (
  ...args: infer Args
) => infer R
  ? AsRestArgs<Args>
  : [];

type AsRest<Obj extends { [K in keyof Obj]: any }> = {
  [K in keyof Obj]: AsRestFn<Obj, K>;
};

export type NameGenType = AsRest<typeof NameGen>;

export type NameGenTypeParams = {
  [K in keyof NameGenType]: (...args: NameGenParameters<K>) => string;
};

export type NameGenKey = keyof NameGenTypeParams;

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

export function toPascalCase(string: string): string {
  return `${string}`
    .toLowerCase()
    .replace(new RegExp(/[-_]+/, "g"), " ")
    .replace(new RegExp(/[^\w\s]/, "g"), "")
    .replace(new RegExp(/\s+(.)(\w*)/, "g"), ($1, $2, $3) => `${$2.toUpperCase() + $3}`)
    .replace(new RegExp(/\w/), (s) => s.toUpperCase());
}
