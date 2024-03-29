import {
  yulAdd,
  pickBestCodeForPreferences,
  roundUpToNextByte,
  roundDownToNextByte
} from "./utils";
import { ReadParameterArgs } from "./types";
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

export function getOptionsReadFromMemory(args: ReadParameterArgs): string[] {
  if (args.bitsLength === 256 && args.bitsOffset % 8 === 0) {
    return [`mload(${yulAdd(args.dataReference, args.bitsOffset / 8)})`];
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
}: ReadParameterArgs) {
  const prevByteBoundaryOffsetBits = roundDownToNextByte(bitsOffset);
  const extraBitsAtStart = bitsOffset - prevByteBoundaryOffsetBits;
  assert(extraBitsAtStart + bitsLength <= 256, `Value can not be read in a single word`);
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
  // end = 32 (256)
  // end containing word = 256
  // extra bits = 0
  // offset in word = 248
  assert(extraBits + bitsLength <= 256, `Value can not be read in a single word`);
  const bitsOffsetWithinWord = 256 - extraBits - bitsLength;

  const pointerExpr = yulAdd(dataReference, endOfContainingWordOffsetBits / 8 - 32);
  const readExpr = `mload(${pointerExpr})`;
  return getOptionsReadFromStack({
    bitsOffset: bitsOffsetWithinWord,
    bitsLength,
    dataReference: readExpr,
    leftAligned
  });
}

function getOptionsReadFromMemoryInFirstWord(args: ReadParameterArgs) {
  const endOfFieldOffsetBits = args.bitsOffset + args.bitsLength;
  if (endOfFieldOffsetBits > 256) return [];
  const readExpr = `mload(${args.dataReference})`;
  return getOptionsReadFromStack({
    ...args,
    dataReference: readExpr
  });
}
