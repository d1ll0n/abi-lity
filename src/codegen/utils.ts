import { findIndex } from "lodash";
import {
  assert,
  ASTNodeFactory,
  Compiler,
  compileSourceStringSync,
  DataLocation,
  Expression,
  FunctionCall,
  FunctionCallKind,
  SourceUnit,
  YulExpression
} from "solc-typed-ast";
import { ArrayType, StructType, TupleType, TypeNode } from "../ast";
import { getInclusiveRangeWith, getYulConstant, StructuredText, toHex } from "../utils";

export function canDeriveSizeInOneStep(type: TypeNode): boolean {
  return type.totalNestedDynamicTypes < 2 && type.totalNestedReferenceTypes < 2;
}

const PointerRoundUp32Mask = `0xffffe0`;

export function roundUpAdd32(ctx: DecoderContext, value: string): string;
export function roundUpAdd32(ctx: SourceUnit, value: YulExpression): YulExpression;
export function roundUpAdd32(
  ctx: SourceUnit | DecoderContext,
  value: YulExpression | string
): string | YulExpression {
  if (ctx instanceof DecoderContext && typeof value === "string") {
    return `and(add(${value}, ${ctx.addConstant("AlmostTwoWords", toHex(63))}), ${ctx.addConstant(
      "OnlyFullWordMask",
      PointerRoundUp32Mask
    )})`;
  } else if (ctx instanceof SourceUnit && value instanceof YulExpression) {
    const mask = getYulConstant(ctx, `OnlyFullWordMask`, PointerRoundUp32Mask);
    const almostTwoWords = getYulConstant(ctx, `AlmostTwoWords`, toHex(63));
    return value.add(almostTwoWords).and(mask);
  }
  throw Error(`Unsupported input types`);
}

export function canCombineTailCopies(type: TypeNode): boolean {
  // Has to be one of:
  // Struct with no embedded reference types
  // Array of value types
  // bytes or string
  // value type
  return type.totalNestedDynamicTypes < 2 && type.totalNestedReferenceTypes < 2;
}

export function abiEncodingMatchesMemoryLayout(type: TypeNode): boolean {
  return type.totalNestedDynamicTypes < 2 && type.totalNestedReferenceTypes < 2;
}

export function getSequentiallyCopyableSegments(struct: StructType): TypeNode[][] {
  const types = struct.vMembers;
  const firstValueIndex = findIndex(types, (t) => t.isValueType);
  if (firstValueIndex < 0) return [];
  const segments: TypeNode[][] = [];
  let currentSegment: TypeNode[] = [];
  let numDynamic = 0;
  const endSegment = () => {
    if (currentSegment.length) {
      const filtered = getInclusiveRangeWith(currentSegment, (t) => t.isValueType);
      // Sanity check: all types in segment are sequential in calldata/memory
      for (let i = 1; i < filtered.length; i++) {
        const { calldataHeadOffset: cdHead, memoryHeadOffset: mHead } = filtered[i];
        const { calldataHeadOffset: cdHeadLast, memoryHeadOffset: mHeadLast } = filtered[i - 1];
        assert(
          cdHeadLast + 32 === cdHead,
          `Got non-sequential calldata heads: [${i - 1}] = ${cdHeadLast}, [${i}] = ${cdHead}`
        );
        assert(
          mHeadLast + 32 === mHead,
          `Got non-sequential memory heads: [${i - 1}] = ${mHeadLast}, [${i}] = ${mHead}`
        );
      }
      segments.push(filtered);
      currentSegment = [];
    }
    numDynamic = 0;
  };
  for (let i = firstValueIndex; i < types.length; i++) {
    const type = types[i];
    if (type.calldataHeadSize !== 32 || (type.isReferenceType && ++numDynamic > 4)) {
      endSegment();
      continue;
    }
    if (type.isValueType) {
      numDynamic = 0;
    }
    currentSegment.push(type);
    if (i === types.length - 1) {
      endSegment();
    }
  }
  return segments;
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

export function getPointerOffsetExpression(
  factory: ASTNodeFactory,
  ptr: Expression,
  type: TypeNode,
  location: DataLocation
): Expression {
  const fnName =
    location === DataLocation.CallData && type.isDynamicallyEncoded ? "pptr" : "offset";
  const offsetFunction = factory.makeMemberAccess("tuple(uint256)", ptr, fnName, -1);
  const headOffset =
    location === DataLocation.CallData ? type.calldataHeadOffset : type.memoryHeadOffset;
  if (headOffset === 0) {
    if (fnName === "pptr") {
      return factory.makeFunctionCall("", FunctionCallKind.FunctionCall, offsetFunction, []);
    }
    return ptr;
  }
  const offsetLiteral = factory.makeLiteralUint256(
    location === DataLocation.CallData ? type.calldataHeadOffset : type.memoryHeadOffset
  );
  const offsetCall = factory.makeFunctionCall("", FunctionCallKind.FunctionCall, offsetFunction, [
    offsetLiteral
  ]);
  return offsetCall;
}
