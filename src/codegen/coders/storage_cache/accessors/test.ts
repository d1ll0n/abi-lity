import { getReadFromMemoryAccessor } from "./read_options";
import { pickBestCodeForPreferences } from "./utils";

const checkValues = (actual: string, expected: string) => {
  if (actual !== expected) {
    throw Error(`Expected:\n${expected}\nbut got:\n${actual}`);
  } else {
    console.log("OK");
  }
};

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
