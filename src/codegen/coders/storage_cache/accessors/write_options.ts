import { assert } from "solc-typed-ast";

import { add, alignValue, maskOmit, pickBestCodeForPreferences, shl, shr, toValue } from "./utils";

export function getWriteToMemoryAccessor(
  dataReference: string,
  leftAligned: boolean,
  memoryOffset: number,
  bytesLength: number,
  value: string | number,
  gasToCodePreferenceRatio?: number,
  defaultSelectionForSameScore?: "leastgas" | "leastcode"
): string {
  const options = getOptionsReplaceValueInMemory(
    dataReference,
    memoryOffset,
    value,
    bytesLength,
    leftAligned
  );
  return pickBestCodeForPreferences(
    options,
    gasToCodePreferenceRatio,
    defaultSelectionForSameScore
  );
}

const getOptionsReplaceRightAlignedValueInMemory = (
  dataReference: string,
  memoryOffset: number,
  value: string | number,
  bytesLength: number,
  valueLeftAligned: boolean
) => {
  const endOfFieldOffset = memoryOffset + bytesLength;
  assert(
    endOfFieldOffset >= 32,
    `Right-aligned replacement requires value be readable at end of word without subtracting from data pointer. Received field ending at byte ${endOfFieldOffset}`
  );
  const bitsLength = bytesLength * 8;
  const bitsBeforeOldValue = 256 - bitsLength;
  const rightAlignedValueExpr = valueLeftAligned
    ? shr(bitsBeforeOldValue, toValue(value))
    : toValue(value);
  const readExpr = `mload(rightAlignedPointer)`;
  const oldValueRemovedWithMask = maskOmit(readExpr, bitsLength, bitsBeforeOldValue);

  const options: string[] = [];

  const pointerExpr = add(dataReference, endOfFieldOffset - 32);

  // Option 1. Read old value right aligned, mask out the old value, and OR in the new value
  options.push(
    [
      `let rightAlignedPointer := ${pointerExpr}`,
      `mstore(rightAlignedPointer, or(${oldValueRemovedWithMask}, ${rightAlignedValueExpr}))`
    ].join("\n")
  );

  // Option 2. Read old value right aligned, shift it twice to remove old value, and OR in the new value
  const oldValueRemovedWithShift = shl(bitsLength, shr(bitsLength, readExpr));
  options.push(
    [
      `let rightAlignedPointer := ${pointerExpr}`,
      `mstore(rightAlignedPointer, or(${oldValueRemovedWithShift}, ${rightAlignedValueExpr}))`
    ].join("\n")
  );

  return options;
};

const getOptionsReplaceMidWordValueInMemory = (
  dataReference: string,
  memoryOffset: number,
  value: string | number,
  bytesLength: number,
  valueLeftAligned: boolean
) => {
  const endOfFieldOffset = memoryOffset + bytesLength;
  assert(
    endOfFieldOffset <= 32 && memoryOffset !== 0,
    `Mid-word replacement requires value in first word between byte 1 and 32. Received field between bytes ${memoryOffset} and ${endOfFieldOffset}`
  );
  const bitsLength = bytesLength * 8;

  const bitsOffsetInWord = memoryOffset * 8;
  const valueAlignedWithOldValue: string = alignValue(
    value,
    bitsLength,
    valueLeftAligned,
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

const getOptionsReplaceLeftAlignedValueInMemory = (
  dataReference: string,
  memoryOffset: number,
  value: string | number,
  bytesLength: number,
  valueLeftAligned: boolean
) => {
  const bitsLength = bytesLength * 8;
  const pointerExpr = add(dataReference, memoryOffset);

  const options: string[] = [];
  const valueAlignedWithOldValue = alignValue(value, bitsLength, valueLeftAligned, 0);

  // Option 1. Read old word left aligned, mask out the old value, and OR in the new value
  const oldValueRemovedWithMask = maskOmit(`mload(startPointer)`, bitsLength, 0);
  options.push(
    [
      `let startPointer := ${pointerExpr}`,
      `mstore(startPointer, or(${oldValueRemovedWithMask}, ${valueAlignedWithOldValue}))`
    ].join("\n")
  );

  // Option 2. Read old word left aligned, shift it twice to remove old value, and OR in the new value
  const oldValueRemovedWithShift = shr(bitsLength, shl(bitsLength, `mload(startPointer)`));
  options.push(
    [
      `let startPointer := ${pointerExpr}`,
      `mstore(startPointer, or(${oldValueRemovedWithShift}, ${valueAlignedWithOldValue}))`
    ].join("\n")
  );

  return options;
};

// For a given field, returns a list of options for writing the field to memory.
// @todo Test all cases
const getOptionsReplaceValueInMemory = (
  dataReference: string,
  memoryOffset: number,
  value: string | number,
  bytesLength: number,
  valueLeftAligned: boolean
) => {
  if (bytesLength === 32) {
    return [`mstore(${add(dataReference, memoryOffset)}, ${toValue(value)})`];
  }
  const endOfFieldOffset = memoryOffset + bytesLength;

  const options: string[] = [];

  // First set of options: read from 32 bytes before the end of the field (right aligned field)
  // Requires the end of the field be at least 32 bytes from the start of the data
  if (endOfFieldOffset >= 32) {
    options.push(
      ...getOptionsReplaceRightAlignedValueInMemory(
        dataReference,
        memoryOffset,
        value,
        bytesLength,
        valueLeftAligned
      )
    );
  }

  // Second set of options: read from the start of the field (left aligned field)
  options.push(
    ...getOptionsReplaceLeftAlignedValueInMemory(
      dataReference,
      memoryOffset,
      value,
      bytesLength,
      valueLeftAligned
    )
  );

  // Third set of options: read from the start of the data (mid-word field)
  // Requires the field be in the first word of the data but not at the start or end of the word
  if (endOfFieldOffset <= 32 && memoryOffset !== 0) {
    options.push(
      ...getOptionsReplaceMidWordValueInMemory(
        dataReference,
        memoryOffset,
        value,
        bytesLength,
        valueLeftAligned
      )
    );
  }

  // If field is one byte, can overwrite that single byte with the new value
  if (bytesLength === 1) {
    const rightAlignedValue = alignValue(value, 8, valueLeftAligned, 248);
    options.push(`mstore8(${add(dataReference, memoryOffset)}, ${rightAlignedValue})`);
  }

  return options;
};

/* function getWriteLeftAligned(
  dataReference: string,
  memoryOffset: number,
  bytesLength: number,
  value: string | number,
  gasToCodePreferenceRatio = 3,
  defaultSelectionForSameScore: "leastgas" | "leastcode" = "leastgas"
) {
  if (bytesLength === 32) {
    return `mstore(${add(dataReference, memoryOffset)}, ${toValue(value)})`;
  }
  if (bytesLength === 1) {
    return `mstore8(${add(dataReference, memoryOffset)}, ${shr(248, value)})`;
  }
  const endOfFieldOffset = memoryOffset + bytesLength;
  const bitsLength = bytesLength * 8;
  const options: string[] = [];
  if (endOfFieldOffset >= 32) {
    // Old value can be read right aligned
    const rightAlignedPointer = add(dataReference, endOfFieldOffset - 32);
    const readExpr = `mload(rightAlignedPointer)`;
    const bitsBefore = 256 - bitsLength;
    const oldValueRemovedWithMask = maskOmit(readExpr, bitsLength, bitsBefore);
    // Option 1. Read old word right aligned, mask out the old value, and OR in the new value
    options.push(
      [
        `let rightAlignedPointer := ${rightAlignedPointer}`,
        `mstore(rightAlignedPointer, or(${oldValueRemovedWithMask}, ${shr(
          bitsBefore,
          toValue(value)
        )}))`
      ].join("\n")
    );
    // Option 2. Read old word right aligned, shift it twice to remove old value, and OR in the new value
    const oldValueRemovedWithShift = shl(bitsBefore, shr(bitsLength, readExpr));
    options.push(
      [
        `let rightAlignedPointer := ${rightAlignedPointer}`,
        `mstore(rightAlignedPointer, or(${oldValueRemovedWithShift}, ${shr(
          bitsBefore,
          toValue(value)
        )}))`
      ].join("\n")
    );
  }
  const startPointer = add(dataReference, memoryOffset);
  // Option 3. Read old word left aligned, mask out the old value, and OR in the new value
  const oldValueRemovedWithMask = maskOmit(`mload(startPointer)`, bitsLength, 0);
  options.push(
    [
      `let startPointer := ${startPointer}`,
      `mstore(startPointer, or(${oldValueRemovedWithMask}, ${toValue(value)}))`
    ].join("\n")
  );
  // Option 4. Read old word left aligned, shift it twice to remove old value, and OR in the new value
  const oldValueRemovedWithShift = shr(bitsLength, shl(bitsLength, `mload(${dataReference})`));
  options.push(`mstore(${startPointer}, or(${oldValueRemovedWithShift}, ${toValue(value)}))`);
  if (endOfFieldOffset < 32 && memoryOffset !== 0) {
    // Option 5. Read old word in place (skip ADD offset), mask out the old value,
    // Requires the field be somewhere in the middle of the first word
    const oldValueRemovedWithMask = maskOmit(
      `mload(${dataReference})`,
      bitsLength,
      memoryOffset * 8
    );
    const bitsAfter = 8 * (32 - endOfFieldOffset);
    options.push(
      `mstore(${dataReference}, or(${oldValueRemovedWithMask}, ${shl(bitsAfter, value)}))`
    );
  }
  return pickBestCodeForPreferences(
    options,
    gasToCodePreferenceRatio,
    defaultSelectionForSameScore
  );
} */
