/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { TestDeployment, getTestDeployment } from "../../src/test_utils/deployment";
import { getCommandLineInputPaths } from "../../src/command_line/utils2";
import path from "path";
import { CompilationOutput } from "solc-typed-ast";
import { getCompilerOptionsWithDefaults } from "../../src/utils/compile_utils/solc";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { writeFileSync } from "fs";
import { cleanIR } from "../../src/codegen/utils";
chai.use(solidity);
const { expect } = chai;

describe("Errors and Events", () => {
  let deployment1: TestDeployment;
  let deployment2: TestDeployment;

  before(async () => {
    const { helper } = await getCommandLineInputPaths(
      {
        input: path.join(__dirname, "output", "sample_code/Sample1.sol")
      },
      false,
      {
        optimizer: true,
        runs: "max",
        metadata: false,
        viaIR: true
      },
      "TESTS"
    );

    helper.recompile({
      outputs: [
        CompilationOutput.ABI,
        CompilationOutput.AST,
        "evm.deployedBytecode.object" as any,
        CompilationOutput.EVM_BYTECODE_OBJECT,
        CompilationOutput.IR_OPTIMIZED
      ],
      settings: getCompilerOptionsWithDefaults({
        optimizer: true,
        runs: "max",
        metadata: false,
        viaIR: true
      })
    });
    let abi: any;
    {
      const contract = helper.getContractForFile("Sample1.sol");
      abi = contract.abi;
      deployment1 = await getTestDeployment(contract.runtimeCode, abi, contract.name);
      writeFileSync(path.join(__dirname, "Sample1.modified.yul"), cleanIR(contract.irOptimized!));
      // writeFileSync(path.join(__dirname, "Sample1.yul"), cleanIR(contract.irOptimized!));
    }
    // upgradeSourceCoders(
    //   helper,
    //   "Sample1.sol",
    //   {
    //     replaceEmitCalls: true,
    //     replaceRevertCalls: true,
    //     // outputToLibrary: true,
    //     decoderFileName: "Sample1Decoder.sol", //path.join(__dirname, "sample_code/Sample1Decoder.sol")
    //     outputPath: path.join(__dirname, "output")
    //   },
    //   new DebugLogger()
    // );

    // helper.writeFilesTo(path.join(__dirname, "output"));

    // helper.recompile({
    //   outputs: [
    //     CompilationOutput.ABI,
    //     CompilationOutput.AST,
    //     "evm.deployedBytecode.object" as any,
    //     CompilationOutput.EVM_BYTECODE_OBJECT,
    //     CompilationOutput.IR_OPTIMIZED
    //   ],
    //   settings: getCompilerOptionsWithDefaults({
    //     optimizer: true,
    //     runs: "max",
    //     metadata: false,
    //     viaIR: true
    //   })
    // });

    // const contract = helper.getContractForFile("Sample1.sol");
    // deployment2 = await getTestDeployment(contract.runtimeCode, abi, contract.name);
    // writeFileSync(path.join(__dirname, "Sample1.modified.yul"), cleanIR(contract.irOptimized!));
  });

  function testDeployment(name: string, getDeployment: () => TestDeployment) {
    return describe(`${name} Deployment`, () => {
      let deployment: TestDeployment;

      before(() => {
        deployment = getDeployment();
      });

      it("Emits events", async () => {
        const result = await deployment.call("emitEvents");
        const logs = result.logs;
        const [EmptyEvent, EventWithParams, EventWithDynamicArray, EventWithStaticArray] = [
          "EmptyEvent",
          "EventWithParams",
          "EventWithDynamicArray",
          "EventWithStaticArray"
        ].map((name) => logs.find((log) => log.name === name));

        expect(EmptyEvent).to.exist;
        expect(EventWithParams).to.exist;
        expect(EventWithDynamicArray).to.exist;
        expect(EventWithStaticArray).to.exist;

        deepEq([...EventWithParams!.args], [1, 2], "EventWithParams");
        deepEq([...EventWithStaticArray!.args[0]], [1, 2], "EventWithStaticArray");
        deepEq([...EventWithDynamicArray!.args[0]], [1, 2], "EventWithDynamicArray");

        console.log(`Gas Used: ${result.executionGasUsed.toString(10)}`);
      });
    });
  }

  const deepEq = (arr1: any[], arr2: any[], message?: string) => {
    expect(arr1.length).to.eq(arr2.length, message && `${message} length`);
    for (let i = 0; i < arr1.length; i++) {
      expect(arr1[i]).to.deep.eq(arr2[i], message && `${message} argument ${i}`);
    }
  };

  testDeployment("Original", () => deployment1);
  testDeployment("Modified", () => deployment2);
});
