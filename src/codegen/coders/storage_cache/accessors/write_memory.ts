import { assert } from "solc-typed-ast";

import {
  yulAdd,
  yulAlignValue,
  maskOmit,
  pickBestCodeForPreferences,
  yulShl,
  yulShr,
  toValue,
  roundUpToNextByte,
  roundDownToNextByte
} from "./utils";
import { WriteParameterArgs } from "./types";

export function getWriteToMemoryAccessor(args: WriteParameterArgs): string {
  const options = getOptionsReplaceValueInMemory(args);
  return pickBestCodeForPreferences(
    options,
    args.gasToCodePreferenceRatio,
    args.defaultSelectionForSameScore
  );
}

// For a given field, returns a list of options for writing the field to memory.
// @todo Test all cases
export const getOptionsReplaceValueInMemory = (args: WriteParameterArgs): string[] => {
  const { dataReference, bitsOffset, bitsLength, value } = args;
  // @todo check if value can be read in one word (if 256, starts at byte boundary)
  if (bitsLength === 256 && bitsOffset % 8 === 0) {
    return [`mstore(${yulAdd(dataReference, bitsOffset / 8)}, ${toValue(value)})`];
  }
  const endOfFieldOffsetBits = bitsOffset + bitsLength;

  const options: string[] = [];

  // First set of options: read from 32 bytes before the end of the field (right aligned field)
  // Requires the end of the field be at least 32 bytes from the start of the data
  if (endOfFieldOffsetBits >= 256) {
    options.push(...getOptionsReplaceValueInMemoryAtEndOfWord(args));
  }

  // Second set of options: read from the start of the field (left aligned field)
  options.push(...getOptionsReplaceValueInMemoryAtStartOfWord(args));

  // Third set of options: read from the start of the data (mid-word field)
  // Requires the field be in the first word of the data but not at the start or end of the word
  if (endOfFieldOffsetBits <= 256 && bitsOffset !== 0) {
    options.push(...getOptionsReplaceMidWordValueInMemory(args));
  }

  // If field is one byte and begins at a byte boundary, can overwrite that
  // single byte with the new value
  if (bitsLength === 8 && bitsOffset % 8 === 0) {
    const rightAlignedValue = yulAlignValue(value, 8, args.leftAligned, 248);
    options.push(`mstore8(${yulAdd(dataReference, bitsOffset / 8)}, ${rightAlignedValue})`);
  }

  return options;
};

const getOptionsReplaceValueInMemoryAtEndOfWord = ({
  dataReference,
  leftAligned,
  bitsLength,
  bitsOffset,
  value
}: WriteParameterArgs) => {
  const endOfFieldOffsetBits = bitsOffset + bitsLength;
  // Right-aligned replacement requires value be readable at end of word without subtracting from data pointer.
  if (endOfFieldOffsetBits < 256) {
    return [];
  }
  // e.g. field starts at bit 285 and ends at bit 290, next byte boundary is at 296, so we read
  // from (296 - 256) = byte 5 within the read word, the field starts at bit (285 - 40) = 245
  const nextByteBoundaryOffsetBits = roundUpToNextByte(endOfFieldOffsetBits);
  const extraBits = nextByteBoundaryOffsetBits - endOfFieldOffsetBits;
  assert(extraBits + bitsLength <= 256, `Value can not be read in a single word`);
  const bitsBeforeOldValue = 256 - extraBits - bitsLength;
  const rightAlignedValueExpr = leftAligned ? yulShr(bitsBeforeOldValue, value) : toValue(value);
  const readExpr = `mload(rightAlignedPointer)`;
  const oldValueRemovedWithMask = maskOmit(readExpr, bitsLength, bitsBeforeOldValue);

  const options: string[] = [];

  const pointerExpr = yulAdd(dataReference, nextByteBoundaryOffsetBits / 8 - 32);

  // Option 1. Read old value right aligned, mask out the old value, and OR in the new value
  options.push(
    [
      `let rightAlignedPointer := ${pointerExpr}`,
      `mstore(rightAlignedPointer, or(${oldValueRemovedWithMask}, ${rightAlignedValueExpr}))`
    ].join("\n")
  );

  if (extraBits === 0) {
    // Option 2. Read old value right aligned, shift it twice to remove old value, and OR in the new value
    const oldValueRemovedWithShift = yulShl(bitsLength, yulShr(bitsLength, readExpr));
    options.push(
      [
        `let rightAlignedPointer := ${pointerExpr}`,
        `mstore(rightAlignedPointer, or(${oldValueRemovedWithShift}, ${rightAlignedValueExpr}))`
      ].join("\n")
    );
  }

  return options;
};

const getOptionsReplaceMidWordValueInMemory = ({
  dataReference,
  leftAligned,
  bitsLength,
  bitsOffset,
  value
}: WriteParameterArgs) => {
  // Mid-word replacement requires value in first word between bits 1 and 256.
  const endOfFieldOffsetBits = bitsOffset + bitsLength;
  if (endOfFieldOffsetBits > 256 || bitsOffset === 0) {
    return [];
  }
  const valueAlignedWithOldValue: string = yulAlignValue(
    value,
    bitsLength,
    leftAligned,
    bitsOffset
  );

  const options: string[] = [];

  // Option 1. Read old value in place, mask out the old value, and OR in the new value
  const oldValueRemovedWithMask = maskOmit(`mload(${dataReference})`, bitsLength, bitsOffset);
  options.push(
    `mstore(${dataReference}, or(${oldValueRemovedWithMask}, ${valueAlignedWithOldValue}))`
  );

  return options;
};

const getOptionsReplaceValueInMemoryAtStartOfWord = ({
  dataReference,
  leftAligned,
  bitsLength,
  bitsOffset,
  value
}: WriteParameterArgs) => {
  const prevByteBoundaryOffsetBits = roundDownToNextByte(bitsOffset);
  const extraBitsAtStart = bitsOffset - prevByteBoundaryOffsetBits;
  assert(extraBitsAtStart + bitsLength <= 256, `Value can not be read in a single word`);
  const pointerExpr = yulAdd(dataReference, prevByteBoundaryOffsetBits / 8);

  const options: string[] = [];
  const valueAlignedWithOldValue = yulAlignValue(value, bitsLength, leftAligned, extraBitsAtStart);

  // Option 1. Read old word left aligned, mask out the old value, and OR in the new value
  const oldValueRemovedWithMask = maskOmit(`mload(startPointer)`, bitsLength, extraBitsAtStart);
  options.push(
    [
      `let startPointer := ${pointerExpr}`,
      `mstore(startPointer, or(${oldValueRemovedWithMask}, ${valueAlignedWithOldValue}))`
    ].join("\n")
  );

  if (extraBitsAtStart === 0) {
    // Option 2. Read old word left aligned, shift it twice to remove old value, and OR in the new value
    const oldValueRemovedWithShift = yulShr(bitsLength, yulShl(bitsLength, `mload(startPointer)`));
    options.push(
      [
        `let startPointer := ${pointerExpr}`,
        `mstore(startPointer, or(${oldValueRemovedWithShift}, ${valueAlignedWithOldValue}))`
      ].join("\n")
    );
  }

  return options;
};
