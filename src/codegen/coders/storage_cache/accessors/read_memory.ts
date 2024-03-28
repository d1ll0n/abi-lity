import {
  yulAdd,
  pickBestCodeForPreferences,
  roundUpToNextByte,
  roundDownToNextByte
} from "./utils";
import { ParameterLocation, ReadParameterArgs } from "./types";
import { getOptionsReadFromStack } from "./read_stack";
import { assert } from "solc-typed-ast";

export function getReadFromMemoryAccessor(args: ReadParameterArgs): string {
  const options = getOptionsReadFromMemory(args);

  return pickBestCodeForPreferences(
    options,
    args.gasToCodePreferenceRatio,
    args.defaultSelectionForSameScore
  );
}

export function getOptionsReadFromMemory(args: ParameterLocation): string[] {
  if (args.bitsLength === 256) {
    return [`mload(${yulAdd(args.dataReference, args.bytesOffset)})`];
  }
  return [
    ...getOptionsReadFromMemoryInFirstWord(args),
    ...getOptionsReadFromMemoryAtStartOfWord(args),
    ...getOptionsReadFromMemoryAtEndOfWord(args)
  ];
}

function getOptionsReadFromMemoryAtStartOfWord({
  dataReference,
  bitsOffset,
  bitsLength,
  leftAligned
}: ParameterLocation) {
  const prevByteBoundaryOffsetBits = roundDownToNextByte(bitsOffset);
  const extraBitsAtStart = bitsOffset - prevByteBoundaryOffsetBits;
  assert(
    extraBitsAtStart + bitsLength <= 256,
    `Value not divisible by 8 bits and can not be read in a single word`
  );
  const readExpr = `mload(${yulAdd(dataReference, prevByteBoundaryOffsetBits / 8)})`;

  return getOptionsReadFromStack({
    bitsOffset: extraBitsAtStart,
    bitsLength,
    dataReference: readExpr,
    leftAligned
  });
}

/**
 * Get options for reading a value from memory by mload'ing
 * 32 bytes before the end of the value. Requires the field
 * end at least 32 bytes from `dataReference` to not underflow,
 * as solc's optimizer does not play nice with subtraction.
 */
export function getOptionsReadFromMemoryAtEndOfWord({
  dataReference,
  bitsOffset,
  bitsLength,
  leftAligned
}: ReadParameterArgs): string[] {
  const endOfFieldOffsetBits = bitsOffset + bitsLength;

  if (endOfFieldOffsetBits < 256) return [];
  // e.g. field starts at bit 285 and ends at bit 290, next byte boundary is at 296, so we read from (296 - 256) = byte 5
  // within the read word, the field starts at bit (285 - 40) = 245
  const endOfContainingWordOffsetBits = roundUpToNextByte(endOfFieldOffsetBits);
  const extraBits = endOfContainingWordOffsetBits - endOfFieldOffsetBits;
  assert(
    extraBits + bitsLength <= 256,
    `Value not divisible by 8 bits and can not be read in a single word`
  );
  const bitsBeforeOldValue = 256 - extraBits - bitsLength;

  const pointerExpr = yulAdd(dataReference, endOfContainingWordOffsetBits / 8 - 32);
  const readExpr = `mload(${pointerExpr})`;
  return getOptionsReadFromStack({
    bitsOffset: bitsBeforeOldValue,
    bitsLength,
    dataReference: readExpr,
    leftAligned
  });
}

function getOptionsReadFromMemoryInFirstWord(args: ParameterLocation) {
  const endOfFieldOffset = args.bitsOffset + args.bitsLength;
  if (endOfFieldOffset > 256) {
    return [];
  }
  const readExpr = `mload(${args.dataReference})`;
  return getOptionsReadFromStack({
    ...args,
    dataReference: readExpr
  });
}
