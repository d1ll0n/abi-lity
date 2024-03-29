import assert from "assert";
import {
  getOptionsReadFromMemory,
  getOptionsReadFromMemoryAtEndOfWord,
  getReadFromMemoryAccessor
} from "./read_memory";
import { pickBestCodeForPreferences, yulShiftAndMask, yulShiftTwice } from "./utils";
import { CompileHelper } from "../../../../utils/compile_utils/compile_helper";
import { writeNestedStructure } from "../../../../utils";
import { CallResult, CallStatus, getTestDeployment } from "../../../../test_utils";
import { defaultAbiCoder } from "@ethersproject/abi";
import { getOptionsReplaceStackValue } from "./write_stack";
import { CompilationOutput, CompilerVersions08 } from "solc-typed-ast";
import { getOptionsReplaceValueInMemory } from "./write_memory";
import { expect } from "chai";

const arrayToErrorMsg = (arr: string[]) => {
  return JSON.stringify(arr, null, 2)
    .split("\n")
    .map((ln) => `  ${ln}`)
    .join("\n");
};

let passes = 0;

function checkValues(actual: string, expected: string): void;
function checkValues(actual: string[], expected: string[]): void;
function checkValues(actual: string | string[], expected: string | string[]): void {
  if (typeof actual === "string" || typeof expected === "string") {
    assert(actual === expected, `Expected:\n${expected}\nbut got:\n${actual}`);
  } else {
    const ok = actual.length === expected.length && actual.every((s, i) => s === expected[i]);
    assert(ok, `Expected:\n${arrayToErrorMsg(expected)}\nbut got:\n${arrayToErrorMsg(actual)}`);
  }
  passes++;
}

type PreferredCodeTestCase = [
  string, // label
  string[], // choices
  string, // expected
  number?, // gasToCodePreferenceRatio
  ("leastgas" | "leastcode")? // defaultSelectionForSameScore
];

describe(`Field accessor generators`, function () {
  describe("pickBestCodeForPreferences", function () {
    const cases: PreferredCodeTestCase[] = [
      [
        "pick lowest gas if sizes match (7b/9g vs 7b/15g)",
        [`and(abc, 0xffffffff)`, `shr(224, shl(224, abc))`],
        `and(abc, 0xffffffff)`
      ],
      [
        `leastgas: add 2 bytes to save 6 gas (9b/9g vs 7b/15g)`,
        [`and(abc, 0xffffffffffff)`, `shr(208, shl(208, abc))`],
        `and(abc, 0xffffffffffff)`
      ],
      [
        `leastcode: add 6 gas to save 2 bytes`,
        [`and(abc, 0xffffffffffff)`, `shr(208, shl(208, abc))`],
        `shr(208, shl(208, abc))`,
        3,
        "leastcode"
      ]
    ];
    cases.forEach(function ([
      label,
      choices,
      expected,
      gasToCodePreferenceRatio,
      defaultSelectionForSameScore
    ]) {
      it(label, function () {
        const actual = pickBestCodeForPreferences(
          choices,
          gasToCodePreferenceRatio,
          defaultSelectionForSameScore
        );
        expect(actual).to.equal(expected);
      });
    });
  });

  describe("getReadFromMemoryAccessor", function () {
    it("Full word, left aligned", function () {
      const options = {
        dataReference: "cache",
        leftAligned: true,
        bitsOffset: 0,
        bitsLength: 256
      };
      expect(getReadFromMemoryAccessor(options)).to.equal(`mload(cache)`);
      expect(getReadFromMemoryAccessor({ ...options, bitsOffset: 256 })).to.equal(
        `mload(add(cache, 0x20))`
      );
    });

    it("Full word, right aligned", function () {
      const options = {
        dataReference: "cache",
        leftAligned: false,
        bitsOffset: 0,
        bitsLength: 256
      };
      expect(getReadFromMemoryAccessor(options)).to.equal(`mload(cache)`);
      expect(getReadFromMemoryAccessor({ ...options, bitsOffset: 256 })).to.equal(
        `mload(add(cache, 0x20))`
      );
    });

    it("Value is left aligned and can not be read right aligned without subtracting from the data pointer", function () {
      // Two top options are:
      // [12 gas, 36 bytes] : and(mload(cache), 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00)
      // [18 gas, 8 bytes]  : shl(0x08, shr(0x08, mload(cache)))
      // With gasToCodePreferenceRatio <= 6/28, should select mask
      const options = {
        dataReference: "cache",
        leftAligned: true,
        bitsOffset: 0,
        bitsLength: 248
      };
      expect(
        getReadFromMemoryAccessor({
          ...options,
          gasToCodePreferenceRatio: 6 / 28
        })
      ).to.equal(`and(mload(cache), 0x${"ff".repeat(31)}00)`);
      expect(
        getReadFromMemoryAccessor({
          ...options,
          gasToCodePreferenceRatio: 6 / 28 + 0.01
        })
      ).to.equal(`shl(0x08, shr(0x08, mload(cache)))`);
    });

    it("bytes31 after first byte: read first word, shift left", function () {
      const options = {
        dataReference: "cache",
        leftAligned: true,
        bitsOffset: 8,
        bitsLength: 248
      };
      expect(getReadFromMemoryAccessor(options)).to.equal(`shl(0x08, mload(cache))`);
    });

    it("bytes31 in second word: read second word, shift left", function () {
      const options = {
        dataReference: "cache",
        leftAligned: true,
        bitsOffset: 256,
        bitsLength: 248
      };
      expect(getReadFromMemoryAccessor(options)).to.equal(`shl(0x08, mload(add(cache, 0x1f)))`);
    });

    it("uint248 at the end of first word: shift twice with default config", function () {
      const options = {
        dataReference: "cache",
        leftAligned: false,
        bitsOffset: 8,
        bitsLength: 248
      };
      expect(getReadFromMemoryAccessor(options)).to.equal(`shr(0x08, shl(0x08, mload(cache)))`);
    });

    it("uint56 at end of first word: shift twice with default config", function () {
      const options = {
        dataReference: "cache",
        leftAligned: false,
        bitsOffset: 200,
        bitsLength: 56
      };
      expect(getReadFromMemoryAccessor(options)).to.equal(`shr(0xc8, shl(0xc8, mload(cache)))`);
    });

    it("uint8 at end of first word: use `byte` with default config", function () {
      const options = {
        dataReference: "cache",
        leftAligned: false,
        bitsOffset: 248,
        bitsLength: 8
      };
      expect(getReadFromMemoryAccessor(options)).to.equal(`byte(31, mload(cache))`);
    });

    it("uint48 at end of first word: use mask with default config", function () {
      const options = {
        dataReference: "cache",
        leftAligned: false,
        bitsOffset: 208,
        bitsLength: 48
      };
      expect(getReadFromMemoryAccessor(options)).to.equal(`and(mload(cache), 0xffffffffffff)`);
    });
  });

  describe("yulShiftAndMask skips redundant ops", function () {
    const testCases = [
      [`bytes32 - noop`, true, 0, 256, "cache"],
      [
        `bytes30 at start of word - only mask`,
        true,
        0,
        240,
        `and(cache, 0x${"ff".repeat(30).padEnd(64, "0")})`
      ],
      [`bytes30 at end of word - only shift`, true, 16, 240, `shl(0x10, cache)`],
      [`bytes2 at end of word - only shift `, true, 240, 16, `shl(0xf0, cache)`],
      [`bytes1.5 at end of word - only shift`, true, 244, 12, `shl(0xf4, cache)`],
      [`bytes1 in middle of word - shift and mask`, true, 240, 8, `shl(0xf0, and(cache, 0xff00))`],
      [`uint256 - noop`, false, 0, 256, `cache`],
      [`uint240 at start of word - only shift`, false, 0, 240, `shr(0x10, cache)`],
      [`uint240 at end of word - only mask`, false, 16, 240, `and(cache, 0x${"ff".repeat(30)})`],
      [`uint8 in middle of word - shift and mask`, false, 240, 8, `and(shr(0x08, cache), 0xff)`],
      [`uint7 in middle of word - shift and mask`, false, 240, 7, `and(shr(0x09, cache), 0x7f)`]
    ] as const;
    testCases.forEach(function ([label, leftAligned, bitsOffset, bitsLength, expected]) {
      it(label, function () {
        expect(
          yulShiftAndMask({
            dataReference: "cache",
            leftAligned,
            bitsOffset,
            bitsLength
          })
        ).to.equal(expected);
      });
    });
  });

  describe("getOptionsReadFromMemoryAtEndOfWord", function () {
    type TestCases = [boolean, number, number, string[]];
    const testCases: TestCases[] = [
      [true, 0, 256, ["mload(cache)"]],
      [true, 248, 256, ["mload(add(cache, 0x1f))"]],
      [
        true,
        248,
        8,
        ["shl(0xf8, mload(cache))", "shl(0xf8, mload(cache))", "shl(0xf8, mload(cache))"]
      ],
      [
        true,
        256,
        8,
        [
          "shl(0xf8, mload(add(cache, 0x01)))",
          "shl(0xf8, mload(add(cache, 0x01)))",
          "shl(0xf8, mload(add(cache, 0x01)))"
        ]
      ],
      [false, 0, 256, ["mload(cache)"]],
      [false, 248, 256, ["mload(add(cache, 0x1f))"]],
      [
        false,
        248,
        8,
        ["byte(31, mload(cache))", "and(mload(cache), 0xff)", "shr(0xf8, shl(0xf8, mload(cache)))"]
      ],
      [
        false,
        256,
        8,
        [
          "byte(31, mload(add(cache, 0x01)))",
          "and(mload(add(cache, 0x01)), 0xff)",
          "shr(0xf8, shl(0xf8, mload(add(cache, 0x01))))"
        ]
      ]
    ];

    testCases.forEach(function ([leftAligned, bitsOffset, bitsLength, expected]) {
      const typeName = leftAligned ? `bytes${bitsLength / 8}` : `uint${bitsLength}`;
      const label = `${typeName} @ ${bitsOffset / 8}`;
      it(label, function () {
        expect(
          getOptionsReadFromMemoryAtEndOfWord({
            dataReference: "cache",
            leftAligned,
            bitsOffset,
            bitsLength
          })
        ).to.deep.eq(expected);
      });
    });
  });
});
