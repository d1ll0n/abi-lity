import { TypeNode } from "../ast";
import NameGen from "../codegen/names";
import { CodegenContext } from "../codegen/utils";
import { EncodingScheme } from "../constants";
import { toHex } from "../utils";

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

export function getOffsetReference(
  ctx: CodegenContext,
  type: TypeNode,
  encoding: EncodingScheme
): string {
  const name = NameGen.structMemberOffset(type, encoding);
  const offset = getOffset(type, encoding);
  return offset > 0 ? ctx.addConstant(name, toHex(offset)) : "";
}

export const memberHeadIsPPtr = (type: TypeNode, encoding: EncodingScheme): boolean =>
  // In solidity's memory encoding, every reference type struct member has a pptr
  (type.isReferenceType && encoding === EncodingScheme.SolidityMemory) ||
  // Dynamic struct members in ABI and solidity memory have pptrs
  (type.isDynamicallyEncoded &&
    [EncodingScheme.ABI, EncodingScheme.SolidityMemory].includes(encoding));

export function getMemberHeadOffset(
  ctx: CodegenContext,
  parentReference: string,
  type: TypeNode,
  encoding: EncodingScheme
): string {
  const offsetReference = getOffsetReference(ctx, type, encoding);
  return getOffsetExpression(parentReference, offsetReference, false);
}

export function getMemberDataOffset(
  ctx: CodegenContext,
  parentReference: string,
  type: TypeNode,
  encoding: EncodingScheme
): string {
  const offsetReference = getOffsetReference(ctx, type, encoding);
  return getOffsetExpression(parentReference, offsetReference, memberHeadIsPPtr(type, encoding));
}
