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

  describe("getReadFromMemoryAccessor: unit", function () {
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
      [`bytes1 in middle of word - shift and mask`, true, 240, 8, `shl(0xf0, and(cache, 0xff00))`],
      [`uint256 - noop`, false, 0, 256, `cache`],
      [`uint240 at start of word - only shift`, false, 0, 240, `shr(0x10, cache)`],
      [`uint240 at end of word - only mask`, false, 16, 240, `and(cache, 0x${"ff".repeat(30)})`],
      [`uint8 in middle of word - shift and mask`, false, 240, 8, `and(shr(0x08, cache), 0xff)`]
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
        31,
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

// Value is full word

type C = [
  string, // label
  boolean, // leftAligned
  number, // bit offset
  number // bit length
];

function shiftAndMaskOnlyUsesNecessaryOps() {
  const testCases = [
    [true, 0, 32, "cache"],
    [true, 0, 30, `and(cache, 0x${"ff".repeat(30).padEnd(64, "0")})`],
    [true, 2, 30, `shl(0x10, cache)`],
    [true, 30, 2, `shl(0xf0, cache)`],
    [true, 30, 1, `shl(0xf0, and(cache, 0xff00))`],
    [false, 0, 32, `cache`],
    [false, 0, 30, `shr(0x10, cache)`],
    [false, 2, 30, `and(cache, 0x${"ff".repeat(30)})`],
    [false, 30, 1, `and(shr(0x08, cache), 0xff)`]
  ] as const;
  for (const [leftAligned, offset, bytesLength, expected] of testCases) {
    checkValues(
      yulShiftAndMask({
        dataReference: "cache",
        leftAligned,
        bitsOffset: offset * 8,
        bitsLength: bytesLength * 8
      }),
      expected
    );
  }
}
// shiftAndMaskOnlyUsesNecessaryOps();

function test_getOptionsReadFromMemoryAtEndOfWord() {
  type TestCases = [boolean, number, number, string[]];
  const testCases: TestCases[] = [
    [true, 0, 32, ["mload(cache)"]],
    [true, 31, 32, ["mload(add(cache, 0x1f))"]],
    [
      true,
      31,
      1,
      ["shl(0xf8, mload(cache))", "shl(0xf8, mload(cache))", "shl(0xf8, mload(cache))"]
    ],
    [
      true,
      32,
      1,
      [
        "shl(0xf8, mload(add(cache, 0x01)))",
        "shl(0xf8, mload(add(cache, 0x01)))",
        "shl(0xf8, mload(add(cache, 0x01)))"
      ]
    ],
    [false, 0, 32, ["mload(cache)"]],
    [false, 31, 32, ["mload(add(cache, 0x1f))"]],
    [
      false,
      31,
      1,
      ["byte(31, mload(cache))", "and(mload(cache), 0xff)", "shr(0xf8, shl(0xf8, mload(cache)))"]
    ],
    [
      false,
      32,
      1,
      [
        "byte(31, mload(add(cache, 0x01)))",
        "and(mload(add(cache, 0x01)), 0xff)",
        "shr(0xf8, shl(0xf8, mload(add(cache, 0x01))))"
      ]
    ]
  ];
  for (const [leftAligned, offset, bytesLength, expected] of testCases) {
    checkValues(
      getOptionsReadFromMemoryAtEndOfWord({
        dataReference: "cache",
        leftAligned,
        bitsOffset: offset * 8,
        bitsLength: bytesLength * 8
      }),
      expected
    );
  }
}
// test_getOptionsReadFromMemoryAtEndOfWord();

async function testSolidityFunctionVersions(
  fnNameToCode: Map<string, string>,
  inputs: any[] = [],
  rawExpectedOutput?: string,
  allowCallFailure = false,
  contractCodePrefix = ""
) {
  const fnsCode = [...fnNameToCode.values()];
  if (contractCodePrefix) {
    fnsCode.unshift(contractCodePrefix);
  }
  const contractCode = writeNestedStructure([`contract Test {`, fnsCode, `}`]);
  const helper = await CompileHelper.fromFiles(new Map([["Test.sol", contractCode]]), `Test.sol`, {
    outputs: [CompilationOutput.ALL],
    version: CompilerVersions08[CompilerVersions08.length - 2],
    settings: {
      evmVersion: "london"
    }
  });
  const contract = helper.contractsMap.get("Test");
  if (!contract?.runtimeCode || contract?.abi.length === 0) {
    throw Error(`Failed to get contract runtime and abi`);
  }
  const abi = JSON.parse(JSON.stringify(contract.abi));
  const deployment = await getTestDeployment(contract.runtimeCode, abi, "Test", "Test");
  const results: CallResult[] = [];

  const testDeployment = async (name: string) => {
    const result = await deployment.call(name, ...inputs);
    const callFailed = !allowCallFailure && result.status !== CallStatus.Success;
    const badOutput = rawExpectedOutput && result.rawReturnData !== rawExpectedOutput;
    const errorMessage = callFailed
      ? "\n\tCall failed"
      : badOutput
      ? [
          "\n\tOutput mismatch!",
          `\n\tExpected: ${rawExpectedOutput}`,
          `\n\tbut got:  ${result.rawReturnData}`
        ]
      : undefined;
    assert(
      errorMessage === undefined,
      [
        `Error in function ${name}`,
        errorMessage,
        "\n",
        `\n\tInputs:    ${inputs.join(", ")}`,
        `\n\tRaw input: ${result.rawData}`,
        `\n\n\tCode: ${fnNameToCode.get(name)}`
      ].join("")
    );
    results.push(result);
  };

  const fnNames = [...fnNameToCode.keys()];
  for (let i = 0; i < fnNames.length; i++) {
    const name = fnNames[i];
    await testDeployment(name);
  }
  return results;
}

async function testWriteFunctionOptionsWithBits(
  leftAligned: boolean,
  bitsOffset: number,
  bitsLength: number,
  label: string,
  yulWriteBlocks: string[],
  contractCodePrefix?: string
) {
  const bytesLength = bitsLength * 8;
  const bytesOffset = bitsOffset * 8;
  const solidityType = leftAligned ? `bytes${bytesLength}` : `uint${bytesLength * 8}`;
  const fnNameToCode = new Map<string, string>();

  for (const code of yulWriteBlocks) {
    const name = `test_${label}_${fnNameToCode.size}`;
    const fn = writeNestedStructure([
      `function ${name}(uint256 oldWord, ${solidityType} valueToSet) external pure returns (uint256 newWord) {`,
      [`assembly {`, [code], `}`],
      `}`
    ]);
    fnNameToCode.set(name, fn);
  }
  const fnNames = [...fnNameToCode.keys()];
  const oldWord = "0x" + "00112233445566778899aabbccddeeff".repeat(2);
  const valueToSet = "0x" + "ab".repeat(bytesLength); //[leftAligned ? "padEnd" : "padStart"](64, "0");
  const newWord = [
    "0x",
    oldWord.slice(2).slice(0, bytesOffset * 2),
    "ab".repeat(bytesLength),
    oldWord.slice(2).slice((bytesOffset + bytesLength) * 2)
  ].join("");
  await testSolidityFunctionVersions(
    fnNameToCode,
    [oldWord, valueToSet],
    defaultAbiCoder.encode(["uint"], [newWord]),
    false,
    contractCodePrefix
  );
  console.log(`Tests passed for ${fnNames.length} options - ${label}`);
}

async function testWriteFunctionOptions(
  leftAligned: boolean,
  offset: number,
  bytesLength: number,
  label: string,
  yulWriteBlocks: string[],
  contractCodePrefix?: string
) {
  const solidityType = leftAligned ? `bytes${bytesLength}` : `uint${bytesLength * 8}`;
  const fnNameToCode = new Map<string, string>();

  for (const code of yulWriteBlocks) {
    const name = `test_${label}_${fnNameToCode.size}`;
    const fn = writeNestedStructure([
      `function ${name}(uint256 oldWord, ${solidityType} valueToSet) external pure returns (uint256 newWord) {`,
      [`assembly {`, [code], `}`],
      `}`
    ]);
    fnNameToCode.set(name, fn);
  }
  const fnNames = [...fnNameToCode.keys()];
  const oldWord = "0x" + "00112233445566778899aabbccddeeff".repeat(2);
  const valueToSet = "0x" + "ab".repeat(bytesLength); //[leftAligned ? "padEnd" : "padStart"](64, "0");
  const newWord = [
    "0x",
    oldWord.slice(2).slice(0, offset * 2),
    "ab".repeat(bytesLength),
    oldWord.slice(2).slice((offset + bytesLength) * 2)
  ].join("");
  await testSolidityFunctionVersions(
    fnNameToCode,
    [oldWord, valueToSet],
    defaultAbiCoder.encode(["uint"], [newWord]),
    false,
    contractCodePrefix
  );
  console.log(`Tests passed for ${fnNames.length} options - ${label}`);
}

async function test_getOptionsReplaceStackValue() {
  const testCases = [
    [true, 0, 2],
    [true, 0, 32],
    [true, 1, 31],
    [true, 15, 4],
    [true, 15, 1],
    [false, 0, 2],
    [false, 0, 32],
    [false, 1, 31],
    [false, 15, 4],
    [false, 15, 1]
  ] as const;
  for (const [leftAligned, offset, bytesLength] of testCases) {
    const options = getOptionsReplaceStackValue({
      value: "valueToSet",
      dataReference: "oldWord",
      leftAligned,
      bitsOffset: offset * 8,
      bitsLength: bytesLength * 8
    }).map((code) => `newWord := ${code}`);
    await testWriteFunctionOptions(leftAligned, offset, bytesLength, "replaceStackValue", options);
  }
}

async function test_getOptionsReplaceValueInMemory() {
  const testCases = [
    [true, 0, 2],
    [true, 0, 32],
    [true, 1, 31],
    [true, 15, 4],
    [true, 15, 1],
    [false, 0, 2],
    [false, 0, 32],
    [false, 1, 31],
    [false, 15, 4],
    [false, 15, 1]
  ] as const;
  for (const [leftAligned, offset, bytesLength] of testCases) {
    const options = getOptionsReplaceValueInMemory({
      value: "valueToSet",
      dataReference: "ptr",
      leftAligned,
      bitsOffset: offset * 8,
      bitsLength: bytesLength * 8
    }).map((code) =>
      [`let ptr := 0`, `mstore(0, oldWord)`, code, `newWord := mload(ptr)`].join("\n")
    );
    await testWriteFunctionOptions(
      leftAligned,
      offset,
      bytesLength,
      "getOptionsReplaceValueInMemory",
      options
    );
  }
}

async function testReadFunctionOptions(
  leftAligned: boolean,
  offset: number,
  bytesLength: number,
  label: string,
  yulReadExpressions: string[],
  contractCodePrefix?: string,
  asmBlockPrefix?: string
) {
  const solidityType = leftAligned ? `bytes${bytesLength}` : `uint${bytesLength * 8}`;
  const fnNameToCode = new Map<string, string>();

  for (const code of yulReadExpressions) {
    const name = `test_${label}_${fnNameToCode.size}`;
    const fn = writeNestedStructure([
      `function ${name}(uint256 word) external pure returns (${solidityType} value) {`,
      [`assembly {`, [...(asmBlockPrefix ? [asmBlockPrefix] : []), `value := ${code}`], `}`],
      `}`
    ]);
    fnNameToCode.set(name, fn);
  }
  const fnNames = [...fnNameToCode.keys()];
  const word = "0x" + "00112233445566778899aabbccddeeff".repeat(2);
  const value = "0x" + word.slice(2).slice(offset * 2, (offset + bytesLength) * 2);
  await testSolidityFunctionVersions(
    fnNameToCode,
    [word],
    defaultAbiCoder.encode([solidityType], [value]),
    false,
    contractCodePrefix
  );
  console.log(`Tests passed for ${fnNames.length} options - ${label}`);
}

async function test_shiftTwice() {
  const testCases = [
    [true, 0, 2],
    [true, 0, 32],
    [true, 1, 31],
    [true, 15, 4],
    [true, 15, 1],
    [false, 0, 2],
    [false, 0, 32],
    [false, 1, 31],
    [false, 15, 4],
    [false, 15, 1]
  ] as const;

  for (const [leftAligned, offset, bytesLength] of testCases) {
    await testReadFunctionOptions(leftAligned, offset, bytesLength, "shiftTwice", [
      yulShiftTwice({
        dataReference: "word",
        leftAligned,
        bitsOffset: offset * 8,
        bitsLength: bytesLength * 8
      })
    ]);
  }
}

async function test_shiftAndMask() {
  const testCases = [
    [true, 0, 2],
    [true, 0, 32],
    [true, 1, 31],
    [true, 15, 4],
    [true, 15, 1],
    [false, 0, 2],
    [false, 0, 32],
    [false, 1, 31],
    [false, 15, 4],
    [false, 15, 1]
  ] as const;

  for (const [leftAligned, offset, bytesLength] of testCases) {
    await testReadFunctionOptions(leftAligned, offset, bytesLength, "shiftAndMask", [
      yulShiftAndMask({
        dataReference: "word",
        leftAligned,
        bitsOffset: offset * 8,
        bitsLength: bytesLength * 8
      })
    ]);
  }
}

async function test_getOptionsReadFromMemory() {
  const asmBlockPrefix = [`let ptr := 0`, `mstore(ptr, word)`].join("\n");
  const testCases = [
    [true, 0, 2],
    [true, 0, 32],
    [true, 1, 31],
    [true, 15, 4],
    [true, 15, 1],
    [false, 0, 2],
    [false, 0, 32],
    [false, 1, 31],
    [false, 15, 4],
    [false, 15, 1]
  ] as const;

  for (const [leftAligned, offset, bytesLength] of testCases) {
    const options = getOptionsReadFromMemory({
      dataReference: "ptr",
      leftAligned,
      bitsOffset: offset * 8,
      bitsLength: bytesLength * 8
    });

    await testReadFunctionOptions(
      leftAligned,
      offset,
      bytesLength,
      "readFromMemory",
      options,
      undefined,
      asmBlockPrefix
    );
  }
}

test_getOptionsReplaceStackValue();
test_shiftTwice();
test_shiftAndMask();
test_getOptionsReadFromMemory();
test_getOptionsReplaceValueInMemory();
