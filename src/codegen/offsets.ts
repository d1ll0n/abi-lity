/**
 * Offset computation helpers for struct member access in generated code.
 *
 * These functions generate pointer arithmetic expressions for accessing struct members
 * at their correct head or data offsets, across ABI, Solidity memory, and super-packed
 * encoding schemes. Uses `pptr` (pointer-to-pointer) for dynamically encoded members
 * whose head slot contains an offset rather than inline data.
 */
import { TypeNode } from "../ast";
import NameGen from "../codegen/names";
import { EncodingScheme } from "../constants";
import { toHex } from "../utils";

/**
 * Generates a Solidity pointer offset expression using the typed pointer library.
 * Uses `.pptr()` for pointer-to-pointer dereference or `.offset()` for direct access.
 */
export function getOffsetExpression(
  parent: string,
  offset: number | string,
  pptr?: boolean
): string {
  const offsetString = typeof offset === "number" ? toHex(offset) : offset;
  const offsetNotNull = Boolean(offset);
  if (pptr) {
    return `${parent}.pptr(${offsetNotNull ? offsetString : ""})`;
  }
  return offsetNotNull ? `${parent}.offset(${offsetString})` : parent;
}

/** Generates a Yul `add(parent, offset)` expression for inline assembly pointer arithmetic. */
export function getOffsetYulExpression(parent: string, offset: number | string): string {
  const offsetString = typeof offset === "number" ? toHex(offset) : offset;
  const offsetNotNull = Boolean(offset);
  return offsetNotNull ? `add(${parent}, ${offsetString})` : parent;
}

function getOffset(type: TypeNode, encoding: EncodingScheme): number {
  switch (encoding) {
    case EncodingScheme.SolidityMemory:
      return type.memoryHeadOffset;
    case EncodingScheme.ABI:
      return type.calldataHeadOffset;
    case EncodingScheme.SuperPacked:
      return type.exactBitsOffset;
  }
}

type ICtx = {
  addConstant(name: string, value: string): string;
};

/** Creates a named constant for a struct member's head offset and returns the constant name. */
export function getOffsetReference(ctx: ICtx, type: TypeNode, encoding: EncodingScheme): string {
  /* if (type.parent?.parent instanceof FunctionType) {
    const fn = type.parent.parent;
    const params = type.parent;
    const returnParameter = params === fn.returnParameters;
    const name = NameGen.functionParameterOffset(type, returnParameter);
    const offset = getOffset(type, encoding);
    return ctx.addConstant(name, toHex(offset));
  } */
  const name = NameGen.structMemberOffset(type, encoding);
  const offset = getOffset(type, encoding);
  return offset > 0 ? ctx.addConstant(name, toHex(offset)) : "";
}

/** Returns true if a struct member's head slot contains a pointer rather than inline data. */
export const memberHeadIsPPtr = (type: TypeNode, encoding: EncodingScheme): boolean =>
  // In solidity's memory encoding, every reference type struct member has a pptr
  (type.isReferenceType && encoding === EncodingScheme.SolidityMemory) ||
  // Dynamic struct members in ABI and solidity memory have pptrs
  (type.isDynamicallyEncoded &&
    [EncodingScheme.ABI, EncodingScheme.SolidityMemory].includes(encoding));

/** Generates a pointer expression for a struct member's head position (no pptr dereference). */
export function getMemberHeadOffset(
  ctx: ICtx,
  parentReference: string,
  type: TypeNode,
  encoding: EncodingScheme
): string {
  const offsetReference = getOffsetReference(ctx, type, encoding);
  return getOffsetExpression(parentReference, offsetReference, false);
}

/** Generates a pointer expression for a struct member's data, using pptr dereference when needed. */
export function getMemberDataOffset(
  ctx: ICtx,
  parentReference: string,
  type: TypeNode,
  encoding: EncodingScheme
): string {
  const offsetReference = getOffsetReference(ctx, type, encoding);
  return getOffsetExpression(parentReference, offsetReference, memberHeadIsPPtr(type, encoding));
}
