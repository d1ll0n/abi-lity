import { assert } from "solc-typed-ast";

import {
  yulAdd,
  alignValue,
  maskOmit,
  pickBestCodeForPreferences,
  yulShl,
  yulShr,
  toValue
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
  const { dataReference, offset, bytesLength, value } = args;
  if (bytesLength === 32) {
    return [`mstore(${yulAdd(dataReference, offset)}, ${toValue(value)})`];
  }
  const endOfFieldOffset = offset + bytesLength;

  const options: string[] = [];

  // First set of options: read from 32 bytes before the end of the field (right aligned field)
  // Requires the end of the field be at least 32 bytes from the start of the data
  if (endOfFieldOffset >= 32) {
    options.push(...getOptionsReplaceRightAlignedValueInMemory(args));
  }

  // Second set of options: read from the start of the field (left aligned field)
  options.push(...getOptionsReplaceLeftAlignedValueInMemory(args));

  // Third set of options: read from the start of the data (mid-word field)
  // Requires the field be in the first word of the data but not at the start or end of the word
  if (endOfFieldOffset <= 32 && offset !== 0) {
    options.push(...getOptionsReplaceMidWordValueInMemory(args));
  }

  // If field is one byte, can overwrite that single byte with the new value
  if (bytesLength === 1) {
    const rightAlignedValue = alignValue(value, 8, args.leftAligned, 248);
    options.push(`mstore8(${yulAdd(dataReference, offset)}, ${rightAlignedValue})`);
  }

  return options;
};

const getOptionsReplaceRightAlignedValueInMemory = ({
  dataReference,
  leftAligned,
  offset,
  bytesLength,
  value
}: WriteParameterArgs) => {
  const endOfFieldOffset = offset + bytesLength;
  assert(
    endOfFieldOffset >= 32,
    `Right-aligned replacement requires value be readable at end of word without subtracting from data pointer. Received field ending at byte ${endOfFieldOffset}`
  );
  const bitsLength = bytesLength * 8;
  const bitsBeforeOldValue = 256 - bitsLength;
  const rightAlignedValueExpr = leftAligned
    ? yulShr(bitsBeforeOldValue, toValue(value))
    : toValue(value);
  const readExpr = `mload(rightAlignedPointer)`;
  const oldValueRemovedWithMask = maskOmit(readExpr, bitsLength, bitsBeforeOldValue);

  const options: string[] = [];

  const pointerExpr = yulAdd(dataReference, endOfFieldOffset - 32);

  // Option 1. Read old value right aligned, mask out the old value, and OR in the new value
  options.push(
    [
      `let rightAlignedPointer := ${pointerExpr}`,
      `mstore(rightAlignedPointer, or(${oldValueRemovedWithMask}, ${rightAlignedValueExpr}))`
    ].join("\n")
  );

  // Option 2. Read old value right aligned, shift it twice to remove old value, and OR in the new value
  const oldValueRemovedWithShift = yulShl(bitsLength, yulShr(bitsLength, readExpr));
  options.push(
    [
      `let rightAlignedPointer := ${pointerExpr}`,
      `mstore(rightAlignedPointer, or(${oldValueRemovedWithShift}, ${rightAlignedValueExpr}))`
    ].join("\n")
  );

  return options;
};

const getOptionsReplaceMidWordValueInMemory = ({
  dataReference,
  leftAligned,
  offset,
  bytesLength,
  value
}: WriteParameterArgs) => {
  const endOfFieldOffset = offset + bytesLength;
  assert(
    endOfFieldOffset <= 32 && offset !== 0,
    `Mid-word replacement requires value in first word between byte 1 and 32. Received field between bytes ${offset} and ${endOfFieldOffset}`
  );
  const bitsLength = bytesLength * 8;

  const bitsOffsetInWord = offset * 8;
  const valueAlignedWithOldValue: string = alignValue(
    value,
    bitsLength,
    leftAligned,
    bitsOffsetInWord
  );

  const options: string[] = [];

  // Option 1. Read old value in place, mask out the old value, and OR in the new value
  const oldValueRemovedWithMask = maskOmit(`mload(${dataReference})`, bitsLength, bitsOffsetInWord);
  options.push(
    `mstore(${dataReference}, or(${oldValueRemovedWithMask}, ${valueAlignedWithOldValue}))`
  );

  return options;
};

const getOptionsReplaceLeftAlignedValueInMemory = ({
  dataReference,
  leftAligned,
  offset,
  bytesLength,
  value
}: WriteParameterArgs) => {
  const bitsLength = bytesLength * 8;
  const pointerExpr = yulAdd(dataReference, offset);

  const options: string[] = [];
  const valueAlignedWithOldValue = alignValue(value, bitsLength, leftAligned, 0);

  // Option 1. Read old word left aligned, mask out the old value, and OR in the new value
  const oldValueRemovedWithMask = maskOmit(`mload(startPointer)`, bitsLength, 0);
  options.push(
    [
      `let startPointer := ${pointerExpr}`,
      `mstore(startPointer, or(${oldValueRemovedWithMask}, ${valueAlignedWithOldValue}))`
    ].join("\n")
  );

  // Option 2. Read old word left aligned, shift it twice to remove old value, and OR in the new value
  const oldValueRemovedWithShift = yulShr(bitsLength, yulShl(bitsLength, `mload(startPointer)`));
  options.push(
    [
      `let startPointer := ${pointerExpr}`,
      `mstore(startPointer, or(${oldValueRemovedWithShift}, ${valueAlignedWithOldValue}))`
    ].join("\n")
  );

  return options;
};
