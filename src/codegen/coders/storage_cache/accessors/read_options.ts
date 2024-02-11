import { assert } from "solc-typed-ast";
import { add, alignValue, maskInclude, pickBestCodeForPreferences, shl, shr } from "./utils";

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
  if (bytesLength === 1 && endOfFieldOffset <= 32) {
    options.push(shl(248, `byte(${memoryOffset}, mload(${dataReference}))`));
  }
  return pickBestCodeForPreferences(
    options,
    gasToCodePreferenceRatio,
    defaultSelectionForSameScore
  );
}

function getOptionsReadValueFromMemoryAtStartOfWord(
  dataReference: string,
  memoryOffset: number,
  bytesLength: number,
  valueLeftAligned: boolean
) {
  // const endOfFieldOffset = memoryOffset + bytesLength;
  const bitsLength = bytesLength * 8;
  const options: string[] = [];
  const memPointer = add(dataReference, memoryOffset);
  const bitsOffsetOnStack = valueLeftAligned ? 0 : 256 - bitsLength;
  // Option 1. Read old word left aligned and extract the value with a mask, then shift it into place
  const maskedValue = maskInclude(`mload(${memPointer})`, bitsLength, 0);
  options.push(alignValue(maskedValue, bitsLength, true, bitsOffsetOnStack));

  if (valueLeftAligned) {
    // Option 2. For left-aligned values, read the field right aligned and shift it twice
    const bitsAfter = 256 - bitsLength;
    options.push(shl(bitsAfter, shr(bitsAfter, `mload(${memPointer})`)));
  } else {
    // Option 3. For right-aligned values, read the field left aligned and shift it into place
    options.push(shr(bitsOffsetOnStack, `mload(${memPointer})`));
  }

  return options;
}

function getOptionsReadValueFromMemoryAtEndOfWord(
  dataReference: string,
  memoryOffset: number,
  bytesLength: number,
  valueLeftAligned: boolean
) {
  const endOfFieldOffset = memoryOffset + bytesLength;
  const bitsLength = bytesLength * 8;
  assert(endOfFieldOffset >= 32, "Field must be at least 32 bytes from the start of the word");

  const options: string[] = [];
  const memPointer = add(dataReference, endOfFieldOffset - 32);
  const bitsOffsetOnStack = valueLeftAligned ? 0 : 256 - bitsLength;

  // Option 1. Read old word right aligned and extract the value with a mask, then shift it into place
  const maskedValue = maskInclude(`mload(${memPointer})`, bitsLength, 256 - bitsLength);
  options.push(alignValue(maskedValue, bitsLength, false, bitsOffsetOnStack));

  if (valueLeftAligned) {
    // Option 2. For left-aligned values, read the field right aligned and shift left
    options.push(shl(bitsOffsetOnStack, `mload(${memPointer})`));
  } else {
    // Option 3. For right-aligned values, read the field right aligned and shift it twice
    const bitsBefore = 256 - bitsLength;
    options.push(shr(bitsBefore, shl(bitsBefore, `mload(${memPointer})`)));
  }

  return options;
}

function getOptionsReadValueFromMemoryInFirstWord(
  dataReference: string,
  memoryOffset: number,
  bytesLength: number,
  valueLeftAligned: boolean
) {
  const endOfFieldOffset = memoryOffset + bytesLength;
  const bitsLength = bytesLength * 8;
  assert(
    endOfFieldOffset <= 32,
    `Read from first word requires field be between bytes 0 and 31. Received field between bytes ${memoryOffset} and ${endOfFieldOffset}`
  );

  const options: string[] = [];
  const readExpr = `mload(${dataReference})`;
  if (valueLeftAligned) {
    // Option 1. Read from first word and shift twice
    const bitsAfter = 8 * (32 - endOfFieldOffset);
    const bitsBeforeAfterShift = 256 - bitsLength;
    options.push(shl(bitsBeforeAfterShift, shr(bitsAfter, readExpr)));
    if (bytesLength === 1) {
      // Option 2. Read from first word, extract single byte and shift into place
      options.push(shl(248, `byte(${memoryOffset}, ${readExpr})`));
    }
  } else {
    // Option 3. Read from first word, shift into place and mask (if needed)
    const bitsBefore = 8 * memoryOffset;
    if (bitsBefore === 0) {
      options.push(shr(256 - bitsLength, readExpr));
    } else {
      options.push(maskInclude(shr(bitsBefore, readExpr), bitsLength, 256 - bitsLength));
    }
    if (bytesLength === 1) {
      // Option 4. Read from first word and extract single byte
      options.push(`byte(${memoryOffset}, ${readExpr})`);
    }
  }

  return options;
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
