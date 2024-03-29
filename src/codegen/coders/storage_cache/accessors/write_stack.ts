import {
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
import { getReadFromStackAccessor } from "./read_stack";
import { assert } from "solc-typed-ast";

export function getWriteToStackAccessor(args: WriteParameterArgs): string {
  const options = getOptionsReplaceStackValue(args);
  return pickBestCodeForPreferences(
    options,
    args.gasToCodePreferenceRatio,
    args.defaultSelectionForSameScore
  );
}

// For a given field, returns a list of options for writing the field to memory.
// @todo Test all cases
export const getOptionsReplaceStackValue = (args: WriteParameterArgs): string[] => {
  const { bitsOffset, bitsLength, value } = args;
  const endOfFieldOffsetBits = bitsOffset + bitsLength;
  assert(
    endOfFieldOffsetBits <= 256,
    "Can not generate stack offset for parameter that is larger than word"
  );
  if (bitsLength === 256) return [toValue(value)];

  const options: string[] = [];

  // First set of options: read from 32 bytes before the end of the field (right aligned field)
  // Requires the end of the field be at least 32 bytes from the start of the data
  if (endOfFieldOffsetBits > 248) {
    options.push(...getOptionsReplaceStackValueAtEndOfWord(args));
  }

  // Second set of options: read from the start of the field (left aligned field)
  options.push(...getOptionsReplaceStackValueAtStartOfWord(args));

  // Third set of options: read from the start of the data (mid-word field)
  // Requires the field be in the first word of the data but not at the start or end of the word
  if (endOfFieldOffsetBits <= 256 && bitsOffset !== 0) {
    options.push(...getOptionsReplaceMidWordStackValue(args));
  }

  // If field is one byte, can overwrite that single byte with the new value
  // if (bytesLength === 1) {
  //   const rightAlignedValue = alignValue(value, 8, args.leftAligned, 248);
  //   options.push(`mstore8(${add(dataReference, offset)}, ${rightAlignedValue})`);
  // }

  return options;
};

const getOptionsReplaceStackValueAtEndOfWord = (args: WriteParameterArgs) => {
  const { dataReference, leftAligned, bitsOffset, bitsLength, value } = args;
  if (bitsLength === 256) return [toValue(value)];

  const endOfFieldOffsetBits = bitsOffset + bitsLength;
  const nextByteBoundaryOffsetBits = roundUpToNextByte(endOfFieldOffsetBits);

  if (nextByteBoundaryOffsetBits !== 256) return [];
  const extraBits = nextByteBoundaryOffsetBits - endOfFieldOffsetBits;
  const bitsBeforeOldValue = 256 - extraBits - bitsLength;
  const rightAlignedValueExpr = leftAligned ? yulShr(bitsBeforeOldValue, value) : toValue(value);
  const oldValueRemovedWithMask = maskOmit(dataReference, bitsLength, bitsBeforeOldValue);

  const options: string[] = [];

  // Option 1. Read old value right aligned, mask out the old value, and OR in the new value
  options.push(`or(${oldValueRemovedWithMask}, ${rightAlignedValueExpr})`);

  if (endOfFieldOffsetBits === 256) {
    // Option 2. Read old value right aligned, shift it twice to remove old value, and OR in the new value
    // Requires the value end exactly at the end of the word
    const oldValueRemovedWithShift = yulShl(bitsLength, yulShr(bitsLength, dataReference));
    options.push(`or(${oldValueRemovedWithShift}, ${rightAlignedValueExpr})`);

    const oldValueRemovedWithStackRead = getReadFromStackAccessor({
      dataReference,
      leftAligned: true,
      bitsLength: 256 - bitsLength,
      bitsOffset: 0
    });
    options.push(`or(${oldValueRemovedWithStackRead}, ${rightAlignedValueExpr})`);
  }

  return options;
};

const getOptionsReplaceMidWordStackValue = ({
  dataReference,
  leftAligned,
  bitsOffset,
  bitsLength,
  value
}: WriteParameterArgs) => {
  const endOfFieldOffsetBits = bitsOffset + bitsLength;
  // Mid-word replacement requires value in first word between byte 1 and 32.
  if (endOfFieldOffsetBits > 256 || bitsOffset === 0) return [];
  const valueAlignedWithOldValue: string = yulAlignValue(
    value,
    bitsLength,
    leftAligned,
    bitsOffset
  );

  // Read old value in place, mask out the old value, and OR in the new value
  const oldValueRemovedWithMask = maskOmit(dataReference, bitsLength, bitsOffset);
  return [`or(${oldValueRemovedWithMask}, ${valueAlignedWithOldValue})`];
};

const getOptionsReplaceStackValueAtStartOfWord = (args: WriteParameterArgs) => {
  const { dataReference, leftAligned, bitsOffset, bitsLength, value } = args;
  const prevByteBoundaryOffsetBits = roundDownToNextByte(bitsOffset);
  const extraBitsAtStart = bitsOffset - prevByteBoundaryOffsetBits;
  if (prevByteBoundaryOffsetBits !== 0) return [];

  const options: string[] = [];
  const valueAlignedWithOldValue = yulAlignValue(value, bitsLength, leftAligned, extraBitsAtStart);

  // Option 1. Read old word left aligned, mask out the old value, and OR in the new value
  const oldValueRemovedWithMask = maskOmit(dataReference, bitsLength, extraBitsAtStart);
  options.push(`or(${oldValueRemovedWithMask}, ${valueAlignedWithOldValue})`);

  if (extraBitsAtStart === 0) {
    // Option 2. Shift twice to remove old value and OR in the new value
    const oldValueRemovedWithShift = yulShr(bitsLength, yulShl(bitsLength, dataReference));
    options.push(`or(${oldValueRemovedWithShift}, ${valueAlignedWithOldValue})`);

    const oldValueRemovedWithStackRead = getReadFromStackAccessor({
      bitsOffset: bitsLength,
      bitsLength: 256 - bitsLength,
      leftAligned: false,
      dataReference
    });
    options.push(`or(${oldValueRemovedWithStackRead}, ${valueAlignedWithOldValue})`);
  }

  return options;
};
