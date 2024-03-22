import assert from "assert";
import {
  getOptionsReadFromMemory,
  getOptionsReadFromMemoryAtEndOfWord,
  getReadFromMemoryAccessor
} from "./read_memory";
import { pickBestCodeForPreferences, shiftAndMask, shiftTwice } from "./utils";
import { CompileHelper } from "../../../../utils/compile_utils/compile_helper";
import { writeNestedStructure } from "../../../../utils";
import { CallResult, CallStatus, getTestDeployment } from "../../../../test_utils";
import { defaultAbiCoder } from "@ethersproject/abi";
import { getOptionsReplaceStackValue } from "./write_stack";
import { CompilationOutput, CompilerVersions08 } from "solc-typed-ast";
import { getOptionsReplaceValueInMemory } from "./write_memory";

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
checkValues(
  getReadFromMemoryAccessor({
    dataReference: "cache",
    leftAligned: true,
    offset: 0,
    bytesLength: 32
  }),
  `mload(cache)`
);
checkValues(
  getReadFromMemoryAccessor({
    dataReference: "cache",
    leftAligned: true,
    offset: 32,
    bytesLength: 32
  }),
  `mload(add(cache, 0x20))`
);

// Value is left aligned and can not be read right aligned without subtracting from the data pointer
// Two top options are:
// and(mload(cache), 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00)
// 12 gas, 36 bytes
// shl(0x08, shr(0x08, mload(cache)))
// 18 gas, 8 bytes
// With gasToCodePreferenceRatio <= 6/28, should select mask
checkValues(
  getReadFromMemoryAccessor({
    dataReference: "cache",
    leftAligned: true,
    offset: 0,
    bytesLength: 31,
    gasToCodePreferenceRatio: 6 / 28
  }),
  `and(mload(cache), 0x${"ff".repeat(31)}00)`
);
checkValues(
  getReadFromMemoryAccessor({
    dataReference: "cache",
    leftAligned: true,
    offset: 0,
    bytesLength: 31,
    gasToCodePreferenceRatio: 6 / 28 + 0.01
  }),
  `shl(0x08, shr(0x08, mload(cache)))`
);

// Value is left aligned and can be read right aligned starting at the data pointer
checkValues(
  getReadFromMemoryAccessor({
    dataReference: "cache",
    leftAligned: true,
    offset: 1,
    bytesLength: 31
  }),
  `shl(0x08, mload(cache))`
);

// Value is left aligned and can be read right aligned adding an offset to the data pointer
checkValues(
  getReadFromMemoryAccessor({
    dataReference: "cache",
    leftAligned: true,
    offset: 32,
    bytesLength: 31
  }),
  `shl(0x08, mload(add(cache, 0x1f)))`
);

// Value is right aligned and ends at the end of the first word, but it is too large to use a mask.
checkValues(
  getReadFromMemoryAccessor({
    dataReference: "cache",
    leftAligned: false,
    offset: 1,
    bytesLength: 31
  }),
  `shr(0x08, shl(0x08, mload(cache)))`
);
checkValues(
  getReadFromMemoryAccessor({
    dataReference: "cache",
    leftAligned: false,
    offset: 25,
    bytesLength: 7
  }),
  `shr(0xc8, shl(0xc8, mload(cache)))`
);

// Value is right aligned and ends at the end of the first word, and it is small enough to use a mask.
checkValues(
  getReadFromMemoryAccessor({
    dataReference: "cache",
    leftAligned: false,
    offset: 31,
    bytesLength: 1
  }),
  `byte(31, mload(cache))`
);
checkValues(
  getReadFromMemoryAccessor({
    dataReference: "cache",
    leftAligned: false,
    offset: 26,
    bytesLength: 6
  }),
  `and(mload(cache), 0xffffffffffff)`
);

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
      shiftAndMask({
        dataReference: "cache",
        leftAligned,
        offset,
        bytesLength
      }),
      expected
    );
  }
}
shiftAndMaskOnlyUsesNecessaryOps();

function test_getOptionsReadFromMemoryAtEndOfWord() {
  type TestCases = [boolean, number, number, string[]];
  const testCases: TestCases[] = [
    [true, 0, 32, ["mload(cache)"]],
    [true, 31, 32, ["mload(add(cache, 0x1f))"]],
    [
      true,
      31,
      1,
      ["shl(0xf8, byte(31, mload(cache)))", "shl(0xf8, mload(cache))", "shl(0xf8, mload(cache))"]
    ],
    [
      true,
      32,
      1,
      [
        "shl(0xf8, byte(31, mload(add(cache, 0x01))))",
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
        offset,
        bytesLength
      }),
      expected
    );
  }
}
test_getOptionsReadFromMemoryAtEndOfWord();

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
          `\n\tExpected ${rawExpectedOutput}`,
          `\n\tbut got ${result.rawReturnData}`
        ]
      : undefined;
    assert(
      errorMessage === undefined,
      [
        `Error in function ${name}`,
        errorMessage,
        `\n\n\tInputs: ${inputs.join(", ")}`,
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
      bytesLength,
      value: "valueToSet",
      dataReference: "oldWord",
      leftAligned,
      offset
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
      bytesLength,
      value: "valueToSet",
      dataReference: "ptr",
      leftAligned,
      offset
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
      shiftTwice({ dataReference: "word", leftAligned, offset, bytesLength })
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
      shiftAndMask({ dataReference: "word", leftAligned, offset, bytesLength })
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
      offset,
      bytesLength
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
