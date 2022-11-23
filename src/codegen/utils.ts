import { ArrayType, StructType, TupleType, TypeNode } from "../ast";
import { StructuredText, toHex } from "../utils";

export function canDeriveSizeInOneStep(type: TypeNode): boolean {
  return type.totalNestedDynamicTypes < 2 && type.totalNestedReferenceTypes < 2;
}

const PointerRoundUp32Mask = `0xffffe0`;

export const roundUpAdd32 = (ctx: DecoderContext, value: string): string =>
  `and(add(${value}, ${ctx.addConstant("AlmostTwoWords", toHex(63))}), ${ctx.addConstant(
    "OnlyFullWordMask",
    PointerRoundUp32Mask
  )})`;

export function canCombineTailCopies(type: TypeNode): boolean {
  // Has to be one of:
  // Struct with no embedded reference types
  // Array of value types
  // bytes or string
  // value type
  return type.totalNestedDynamicTypes < 2 && type.totalNestedReferenceTypes < 2;
}

function convertToTuple(node: ArrayType) {
  if (node.isDynamicallySized) {
    throw Error(`Can not convert dynamic length array to tuple ${node.pp()}`);
  }
  const length = node.length as number;
  const members = new Array(length).fill(null).map((_, i) => {
    const name = (node.labelFromParent ?? node.identifier).concat(i.toString());
    const base = node.baseType.copy();
    base.labelFromParent = name;
    return base;
  });

  if (node.parent) {
    node.parent.replaceChild(node, ...members);
    return node.parent;
  } else {
    return new TupleType(members);
  }
}

export function convertFixedLengthArraysToTuples<T extends ArrayType | StructType | TupleType>(
  type: T
): TypeNode {
  type.walkChildren((node) => {
    if (node instanceof ArrayType && !node.isDynamicallySized) {
      convertToTuple(node);
    }
  });
  if (type instanceof ArrayType && !type.isDynamicallySized) {
    return convertToTuple(type);
  }
  return type;
}

export class DecoderContext {
  constants: Map<string, string> = new Map();
  functions: Map<string, StructuredText> = new Map();

  hasConstant(name: string): boolean {
    return this.constants.has(name);
  }

  hasFunction(name: string): boolean {
    return this.functions.has(name);
  }

  addConstant(name: string, value: string | number): string {
    if (this.hasConstant(name)) return name;
    if (typeof value === "number") value = toHex(value);
    this.constants.set(name, `uint256 constant ${name} = ${value};`);
    return name;
  }

  addFunction(name: string, code: StructuredText): string {
    if (this.hasFunction(name)) return name;
    this.functions.set(name, code);
    return name;
  }
}
