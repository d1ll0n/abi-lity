import { writeNestedStructure } from "../../../utils";

export const abiDecodeBytes = {
  code: [
    `assembly {`,
    [
      `/// Get the current free memory pointer.`,
      `mPtrLength := mload(FreeMemoryPointerSlot)`,

      `/// Derive the size of the bytes array, rounding up to nearest word`,
      `/// and adding a word for the length field. Note: masking`,
      `/// \`calldataload(cdPtrLength)\` is redundant here.`,
      `let size := add(`,
      [
        `and(`,
        [`add(calldataload(cdPtrLength), ThirtyOneBytes),`, `OnlyFullWordMask`],
        `),`,
        `OneWord`
      ],
      `)`,

      `/// Copy bytes from calldata into memory based on pointers and size.`,
      `calldatacopy(mPtrLength, cdPtrLength, size)`,

      `/// Store the masked value in memory. Note: the value of \`size\` is at`,
      `/// least 32, meaning the calldatacopy above will at least write to`,
      `/// \`[mPtrLength, mPtrLength + 32)\`.`,
      `mstore(`,
      [`mPtrLength,`, `and(calldataload(cdPtrLength), OffsetOrLengthMask)`],
      `)`,
      `/// Update free memory pointer based on the size of the bytes array.`,
      `mstore(FreeMemoryPointerSlot, add(mPtrLength, size))`
    ],
    `}`
  ]
};

export const abiEncodeBytes = {
  comment: [
    `/// @dev Takes a bytes array in memory and copies it to a new location in`,
    `///      memory.`,
    `///`,
    `/// @param src A memory pointer referencing the bytes array to be copied (and`,
    `///            pointing to the length of the bytes array).`,
    `/// @param dst A memory pointer referencing the location in memory to copy`,
    `///            the bytes array to (and pointing to the length of the copied`,
    `///            bytes array).`,
    `///`,
    `/// @return size The size of the encoded bytes array, including the size of the length.`
  ],
  code: [
    `unchecked {`,
    [
      `// Mask the length of the bytes array to protect against overflow`,
      `// and round up to the nearest word.`,
      `size = (src.readUint256() + SixtyThreeBytes) & OnlyFullWordMask;`,
      `// Copy the bytes array to the new memory location.`,
      `src.copy(dst, size);`
    ],
    `}`
  ]
};

// console.log(writeNestedStructure(abiDecodeBytes.code));
