import {
  yulAdd,
  yulAlignValue,
  maskOmit,
  pickBestCodeForPreferences,
  yulShl,
  yulShr,
  toValue
} from "./utils";
import { WriteParameterArgs } from "./types";
import { getReadFromStackAccessor } from "./read_stack";
import { assert } from "console";

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
  const { dataReference, bitsOffset, bitsLength, value } = args;
  const endOfFieldOffsetBits = bitsOffset + bitsLength;
  assert(
    endOfFieldOffsetBits <= 256,
    "Can not generate stack offset for parameter that is larger than word"
  );
  if (bitsLength === 256) return [toValue(value)];

  const options: string[] = [];

  // First set of options: read from 32 bytes before the end of the field (right aligned field)
  // Requires the end of the field be at least 32 bytes from the start of the data
  if (endOfFieldOffsetBits >= 256) {
    options.push(...getOptionsReplaceRightAlignedStackValue(args));
  }

  // Second set of options: read from the start of the field (left aligned field)
  options.push(...getOptionsReplaceLeftAlignedStackValue(args));

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

const getOptionsReplaceRightAlignedStackValue = (args: WriteParameterArgs) => {
  const { dataReference, leftAligned, bytesOffset: offset, bytesLength, value } = args;

  const endOfFieldOffset = offset + bytesLength;
  if (endOfFieldOffset !== 32) return [];

  if (bytesLength === 32) {
    return [toValue(value)];
  }

  const bitsLength = bytesLength * 8;
  const bitsBeforeOldValue = 256 - bitsLength;
  const rightAlignedValueExpr = leftAligned
    ? yulShr(bitsBeforeOldValue, toValue(value))
    : toValue(value);
  const oldValueRemovedWithMask = maskOmit(dataReference, bitsLength, bitsBeforeOldValue);

  const options: string[] = [];

  // Option 1. Read old value right aligned, mask out the old value, and OR in the new value
  options.push(`or(${oldValueRemovedWithMask}, ${rightAlignedValueExpr})`);

  // Option 2. Read old value right aligned, shift it twice to remove old value, and OR in the new value
  const oldValueRemovedWithShift = yulShl(bitsLength, yulShr(bitsLength, dataReference));
  options.push(`or(${oldValueRemovedWithShift}, ${rightAlignedValueExpr})`);

  const oldValueRemovedWithStackRead = getReadFromStackAccessor({
    ...args,
    leftAligned: true,
    bytesLength: 32 - bytesLength,
    bytesOffset: 0
  });
  options.push(`or(${oldValueRemovedWithStackRead}, ${rightAlignedValueExpr})`);

  return options;
};

const getOptionsReplaceMidWordStackValue = ({
  dataReference,
  leftAligned,
  bytesOffset: offset,
  bytesLength,
  value
}: WriteParameterArgs) => {
  const endOfFieldOffset = offset + bytesLength;
  // Mid-word replacement requires value in first word between byte 1 and 32.
  if (endOfFieldOffset > 32 || offset === 0) return [];
  const bitsLength = bytesLength * 8;
  const bitsOffsetInWord = offset * 8;
  const valueAlignedWithOldValue: string = yulAlignValue(
    value,
    bitsLength,
    leftAligned,
    bitsOffsetInWord
  );

  // Read old value in place, mask out the old value, and OR in the new value
  const oldValueRemovedWithMask = maskOmit(dataReference, bitsLength, bitsOffsetInWord);
  return [`or(${oldValueRemovedWithMask}, ${valueAlignedWithOldValue})`];
};

const getOptionsReplaceLeftAlignedStackValue = (args: WriteParameterArgs) => {
  const { dataReference, leftAligned, bytesLength, value } = args;
  if (args.bytesOffset !== 0) return [];
  const bitsLength = bytesLength * 8;

  const options: string[] = [];
  const valueAlignedWithOldValue = yulAlignValue(value, bitsLength, leftAligned, 0);

  // Option 1. Read old word left aligned, mask out the old value, and OR in the new value
  const oldValueRemovedWithMask = maskOmit(dataReference, bitsLength, 0);
  options.push(`or(${oldValueRemovedWithMask}, ${valueAlignedWithOldValue})`);

  // Option 2. Shift twice to remove old value and OR in the new value
  const oldValueRemovedWithShift = yulShr(bitsLength, yulShl(bitsLength, dataReference));
  options.push(`or(${oldValueRemovedWithShift}, ${valueAlignedWithOldValue})`);

  const oldValueRemovedWithStackRead = getReadFromStackAccessor({
    bytesOffset: bytesLength,
    bitsOffset: bytesLength * 8,
    bytesLength: 32 - bytesLength,
    bitsLength: 256 - bitsLength,
    leftAligned: false,
    dataReference
  });
  options.push(`or(${oldValueRemovedWithStackRead}, ${valueAlignedWithOldValue})`);

  return options;
};
