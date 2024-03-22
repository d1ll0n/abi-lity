import { assert, yulBuiltins } from "solc-typed-ast";
import { getInclusionMask, getOmissionMask, toHex } from "../../../utils";

// Returns a Yul expression that masks out the bits from `offset` to `offset + bitsLength`
const maskOmit = (value: string, bitsLength: number, offset: number) =>
  `and(${value}, ${getOmissionMask(bitsLength, offset)})`;

// Returns a Yul expression that only includes the bits from `offset` to `offset + bitsLength`
const maskInclude = (value: string, bitsLength: number, offset: number) =>
  `and(${value}, ${getInclusionMask(bitsLength, offset)})`;

export function getReadFromMemoryAccessor(
  dataReference: string,
  leftAligned: boolean,
  memoryOffset: number,
  bytesLength: number,
  gasToCodePreferenceRatio?: number,
  defaultSelectionForSameScore?: "leastgas" | "leastcode"
): string {
  if (bytesLength === 32) {
    return `mload(${add(dataReference, memoryOffset)})`;
  }
  return (leftAligned ? getReadLeftAligned : getReadRightAligned)(
    dataReference,
    memoryOffset,
    bytesLength,
    gasToCodePreferenceRatio,
    defaultSelectionForSameScore
  );
  // if (leftAligned) {
  //   return getReadLeftAligned(
  //     dataReference,
  //     memoryOffset,
  //     bytesLength,
  //     gasToCodePreferenceRatio,
  //     defaultSelectionForSameScore
  //   );
  // // If the field is left aligned and the distance between the end of the field and the first
  // // byte of the data is at least 32 bytes, we can read so that the field is at the end of the slot
  // // and then shift it to the left to minimize codesize.
  // // If it is left aligned and the distance is less than 32 bytes, we must read the field left aligned
  // // and mask it.
  // if (endOfFieldOffset >= 32) {
  //   // Member is read right aligned and shifted to the left
  //   const memPointer = add(dataReference, endOfFieldOffset - 32);
  //   return `shl(${toHex(256 - bitsLength)}, mload(${memPointer}))`;
  // }
  // // Member is read left aligned and masked
  // const memPointer = add(dataReference, memoryOffset);
  // return `and(mload(${memPointer}), ${getInclusionMask(bitsLength, 0)})`;
  // }
  // If the field is at the end of the word starting at the first byte of the data,
  // we can read it right aligned without an add operation, saving gas.
  // We only do this if using a mask would add 2 bytes or less to the code compared
  // to the shift approach, to avoid ballooning the codesize with masks.
  // @note This decision means that we are willing to add 2 bytes of code
  //       to save 6 gas.
  // 2 bytes @ 12 vs 4 bytes @ 9
  // 6, 9 - 12
  // const isAlreadyRightAligned = endOfFieldOffset === 32;
  // const options: string[] = [];

  // // Option 1. Member is read right aligned and masked
  // // Requires it be possible to read the field right aligned without subtracting from the data pointer.
  // if (endOfFieldOffset >= 32) {
  //   const readExpr = `mload(${add(dataReference, endOfFieldOffset - 32)})`;
  //   const mask = getInclusionMask(bitsLength, 256 - bitsLength);
  //   options.push(`and(${readExpr}, ${mask})`);
  // }
  // // Option 2. Member is read left aligned and shifted to the right
  // options.push(
  //   shr(256 - bitsLength, `mload(${add(dataReference, memoryOffset)})`)
  // );
  // // Option 3. Member is read in place and shifted twice
  // // Requires the member be in the first word of the data.
  // if (endOfFieldOffset <= 32) {
  //   const bitsBefore = 8 * memoryOffset;
  //   const bitsAfterAfterShift = 256 - bitsLength;
  //   options.push(shr(bitsAfterAfterShift, shl(bitsBefore, `mload(${dataReference})`)));
  // }
}

const checkValues = (actual: string, expected: string) => {
  if (actual !== expected) {
    throw Error(`Expected:\n${expected}\nbut got:\n${actual}`);
  } else {
    console.log("OK");
  }
};

function isNumeric(n: string | number) {
  if (typeof n === "number") return true;
  return /^-?\d+$/.test(n) || n.startsWith("0x");
}
const isNotNumeric = (n: string | number): n is string => !isNumeric(n);
const isZero = (n: string | number) => isNumeric(n) && BigInt(n) === 0n;
const toValue = (n: string | number) => (isNumeric(n) ? toHex(BigInt(n)) : n);

const shl = (bits: number, value: string | number) => {
  if (isNotNumeric(value)) {
    return bits === 0 ? value : `shl(${toHex(bits)}, ${value})`;
  }
  return toHex(BigInt(value) << BigInt(bits));
};

const shr = (bits: number, value: string | number) => {
  if (isNotNumeric(value)) {
    return bits === 0 ? value : `shr(${toHex(bits)}, ${value})`;
  }
  return toHex(BigInt(value) >> BigInt(bits));
};

const add = (a: string | number, b: string | number) => {
  if (isNumeric(a) && isNumeric(b)) {
    return toHex(BigInt(a) + BigInt(b));
  }
  if (isZero(a)) return b;
  if (isZero(b)) return a;
  return `add(${toValue(a)}, ${toValue(b)})`;
};

function getReadLeftAligned(
  dataReference: string,
  memoryOffset: number,
  bytesLength: number,
  gasToCodePreferenceRatio = 3,
  defaultSelectionForSameScore: "leastgas" | "leastcode" = "leastgas"
) {
  if (bytesLength === 32) {
    return `mload(${add(dataReference, memoryOffset)})`;
  }
  const endOfFieldOffset = memoryOffset + bytesLength;
  const bitsLength = bytesLength * 8;
  // If the distance between the end of the field and the first byte of the data is at least 32
  // bytes (i.e. the value is contained in the first word), we can read so that the field is at
  // the end of the slot and then shift it to the left.
  if (endOfFieldOffset >= 32) {
    // Member is read right aligned and shifted to the left
    const memPointer = add(dataReference, endOfFieldOffset - 32);
    return shl(256 - bitsLength, `mload(${memPointer})`);
  }
  // Member can not be read right aligned without subtracting from the data pointer
  const options: string[] = [];

  // Option 1: Read left aligned and mask
  options.push(maskInclude(`mload(${add(dataReference, memoryOffset)})`, bitsLength, 0));
  // Option 2: Read in place and shift twice
  const bitsAfter = 8 * (32 - endOfFieldOffset);
  const bitsBeforeAfterShift = 256 - bitsLength;
  options.push(shl(bitsBeforeAfterShift, shr(bitsAfter, `mload(${dataReference})`)));
  // Option 3. Read in place, extract single byte and shift into place
  // Requires the field be a single byte
  if (bytesLength === 1) {
    options.push(shl(248, `byte(${memoryOffset}, mload(${dataReference}))`));
  }
  return pickBestCodeForPreferences(
    options,
    gasToCodePreferenceRatio,
    defaultSelectionForSameScore
  );
}

function getReadRightAligned(
  dataReference: string,
  memoryOffset: number,
  bytesLength: number,
  gasToCodePreferenceRatio = 3,
  defaultSelectionForSameScore: "leastgas" | "leastcode" = "leastgas"
) {
  if (bytesLength === 32) {
    return `mload(${add(dataReference, memoryOffset)})`;
  }
  const endOfFieldOffset = memoryOffset + bytesLength;
  const bitsLength = bytesLength * 8;

  const options: string[] = [];

  // Option 1. Member is read right aligned and masked
  // Requires it be possible to read the field right aligned without subtracting from the data pointer.
  if (endOfFieldOffset >= 32) {
    const readExpr = `mload(${add(dataReference, endOfFieldOffset - 32)})`;
    const bitsBefore = 256 - bitsLength;
    options.push(maskInclude(readExpr, bitsLength, bitsBefore));
  }
  // Option 2. Member is read left aligned and single byte is extracted
  // Requires the field be a single byte
  if (bytesLength === 1) {
    options.push(`byte(${memoryOffset}, mload(${add(dataReference, memoryOffset)}))`);
  }
  // Option 3. Member is read left aligned and shifted to the right
  options.push(shr(256 - bitsLength, `mload(${add(dataReference, memoryOffset)})`));
  // Option 4. Member is read in place and shifted twice
  // Requires the member be in the first word of the data.
  if (endOfFieldOffset <= 32) {
    const bitsBefore = 8 * memoryOffset;
    const bitsAfterAfterShift = 256 - bitsLength;
    options.push(shr(bitsAfterAfterShift, shl(bitsBefore, `mload(${dataReference})`)));
    // Option 5. Read in place and extract single byte
    // Requires the field be a single byte
    if (bytesLength === 1) {
      options.push(`byte(${memoryOffset}, mload(${dataReference}))`);
    }
  }

  return pickBestCodeForPreferences(
    options,
    gasToCodePreferenceRatio,
    defaultSelectionForSameScore
  );
}

function getWriteToMemoryAccessor(
  dataReference: string,
  leftAligned: boolean,
  memoryOffset: number,
  bytesLength: number,
  value: string | number,
  gasToCodePreferenceRatio?: number,
  defaultSelectionForSameScore?: "leastgas" | "leastcode"
): string {
  if (bytesLength === 32) {
    return `mstore(${add(dataReference, memoryOffset)}, ${toValue(value)})`;
  }
  return (leftAligned ? getWriteLeftAligned : getWriteRightAligned)(
    dataReference,
    memoryOffset,
    bytesLength,
    value,
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

const alignValue = (
  valueExpr: string | number,
  bitsLength: number,
  leftAligned: boolean,
  targetOffset: number
) => {
  const currentOffset = leftAligned ? 0 : 256 - bitsLength;
  const shift = targetOffset - currentOffset;
  // if (shift === 0) return valueExpr;
  return (shift > 0 ? shr : shl)(shift, valueExpr);
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
    `Mid-word replacement requires value in first word between byte 1 and 31. Received field between bytes ${memoryOffset} and ${endOfFieldOffset}`
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

type WriteValueArgs = {
  dataReference: string;
  memoryOffset: number;
  bytesLength: number;
  value: string | number;
  valueLeftAligned: boolean;
  gasToCodePreferenceRatio?: number;
  defaultSelectionForSameScore?: "leastgas" | "leastcode";
};

export function getWriteWordToMemory(args: WriteValueArgs): string {
  const options = getOptionsReplaceValueInMemory(args);
  return pickBestCodeForPreferences(
    options,
    args.gasToCodePreferenceRatio,
    args.defaultSelectionForSameScore
  );
}

// For a given field, returns a list of options for writing the field to memory.
// @todo Test all cases
const getOptionsReplaceValueInMemory = ({
  dataReference,
  memoryOffset,
  value,
  bytesLength,
  valueLeftAligned
}: WriteValueArgs) => {
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

function getWriteLeftAligned(
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
}

// The gas to code preference ratio is the amount of gas that must be saved to add 1 byte of code.
// Example:
// Willing to add up to 1 byte of code per 3 gas saved
// So to score the options, we multiply the bytes by 3 and add the gas
// 4 bytes, 6 gas -> 18
// 2 bytes, 9 gas -> 15
// 10 bytes, 3 gas -> 33
// The option with the lowest score is the best option. If there is a tie, the option with the
// lowest value for the given default preference is selected.
function pickBestCodeForPreferences(
  options: string[],
  gasToCodePreferenceRatio = 3,
  defaultSelectionForSameScore: "leastgas" | "leastcode" = "leastgas"
) {
  const optionCosts = options.map((code) => ({ code, ...measureGasAndSize(code) }));
  optionCosts.sort((a, b) => {
    const aScore = a.gas + a.bytes * gasToCodePreferenceRatio;
    const bScore = b.gas + b.bytes * gasToCodePreferenceRatio;
    if (aScore === bScore) {
      if (defaultSelectionForSameScore === "leastgas") {
        return a.gas - b.gas;
      } else {
        return a.bytes - b.bytes;
      }
    }
    return aScore - bScore;
  });
  return optionCosts[0].code;
}

// 7 bytes, 9 gas
// 7 bytes, 15 gas
checkValues(
  pickBestCodeForPreferences([`and(abc, 0xffffffff)`, `shr(224, shl(224, abc))`]),
  `and(abc, 0xffffffff)`
);
// 9 bytes, 9 gas -> 36
// 7 bytes, 15 gas -> 36
// leastgas -> 9 bytes, 9 gas
// leastcode -> 7 bytes, 15 gas
checkValues(
  pickBestCodeForPreferences([`and(abc, 0xffffffffffff)`, `shr(208, shl(208, abc))`]),
  `and(abc, 0xffffffffffff)`
);
checkValues(
  pickBestCodeForPreferences(
    [`and(abc, 0xffffffffffff)`, `shr(208, shl(208, abc))`],
    3,
    "leastcode"
  ),
  `shr(208, shl(208, abc))`
);

// Value is full word
checkValues(getReadFromMemoryAccessor("cache", true, 0, 32), `mload(cache)`);
checkValues(getReadFromMemoryAccessor("cache", true, 32, 32), `mload(add(cache, 0x20))`);

// Value is left aligned and can not be read right aligned without subtracting from the data pointer
checkValues(
  getReadFromMemoryAccessor("cache", true, 0, 31),
  `and(mload(cache), 0x${"ff".repeat(31)}00)`
);

// Value is left aligned and can be read right aligned starting at the data pointer
checkValues(getReadFromMemoryAccessor("cache", true, 1, 31), `shl(0x08, mload(cache))`);

// Value is left aligned and can be read right aligned adding an offset to the data pointer
checkValues(getReadFromMemoryAccessor("cache", true, 32, 31), `shl(0x08, mload(add(cache, 0x1f)))`);

// Value is right aligned and ends at the end of the first word, but it is too large to use a mask.
checkValues(getReadFromMemoryAccessor("cache", false, 1, 31), `shr(0x08, mload(add(cache, 0x01)))`);
checkValues(getReadFromMemoryAccessor("cache", false, 25, 7), `shr(0xc8, mload(add(cache, 0x19)))`);

// Value is right aligned and ends at the end of the first word, and it is small enough to use a mask.
checkValues(getReadFromMemoryAccessor("cache", false, 31, 1), `and(mload(cache), 0xff)`);
checkValues(getReadFromMemoryAccessor("cache", false, 26, 6), `and(mload(cache), 0xffffffffffff)`);

// Assumes all instructions are 3 gas
function measureGasAndSize(code: string) {
  const lines = code.split("\n");
  const startingPosition = { gas: 0, bytes: 0 };
  const codeToMeasure = [];
  for (const line of lines) {
    if (line.includes(":=")) {
      // Line has variable assignment. Assuming the assignment is used in the remaining
      // lines, each identifier will be counted as 3 gas (for a dup) and 1 byte.
      // Since the assignment is part of the measured code, we should calculate the cost
      // of the assigned value and then subtract one byte and 3 gas from the total, as
      // the last identifier will probably use the value rather than dup it.
      const [, value] = line.split(":=");
      const cost = measureGasAndSize(value);
      startingPosition.gas += cost.gas - 3;
      startingPosition.bytes += cost.bytes - 1;
    } else {
      codeToMeasure.push(line);
    }
  }
  const ops = codeToMeasure
    .join(",")
    .replace(/\s/g, "")
    .split(/,|\(|\)/g)
    .filter((x) => x !== "");
  const yulInstructions = [...yulBuiltins.members.keys()];
  // Should this handle PUSH0?
  return ops.reduce(
    (acc, curr) => {
      if (curr.startsWith("0x")) {
        // Push instruction - uses 1 + size of data bytes
        const size = curr.length / 2; // don't sub 1 for 0x because of the PUSHN opcode
        acc.bytes += size;
        acc.gas += 3;
      } else if (yulInstructions.includes(curr)) {
        acc.gas += 3;
        acc.bytes += 1;
      } else if (/^-?\d+$/.test(curr)) {
        // Push instruction - uses 1 + size of data bytes
        const hexValue = toHex(BigInt(curr));
        const size = hexValue.length / 2; // don't sub 1 for 0x because of the PUSHN opcode
        acc.bytes += size;
        acc.gas += 3;
      } else {
        // Assume it is some identifier that will resolve to a dup
        acc.bytes += 1;
        acc.gas += 3;
      }
      return acc;
    },
    { gas: 0, bytes: 0 }
  );
}
