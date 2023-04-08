#!/usr/bin/env node
import { JsonFragment } from "@ethersproject/abi";
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  ContractDefinition,
  FunctionDefinition,
  FunctionVisibility,
  getFilesAndRemappings,
  LatestCompilerVersion
} from "solc-typed-ast";
import yargs, { CommandModule, Options } from "yargs";
import { FunctionType, StructType, TupleType } from "../../ast";
import { isExternalFunction } from "../../codegen";
import {
  addExternalWrappers,
  generateSerializers,
  upgradeSourceCoders
} from "../../codegen/generate";
import { cleanIR } from "../../codegen/utils";
import {
  functionDefinitionToTypeNode,
  readTypeNodesFromABI,
  readTypeNodesFromSolcAST,
  readTypeNodesFromSolidity
} from "../../readers";
import { createCalldataCopiers, testCopiers } from "../../test_utils";
import { getAllContractDeployments, testDeployments } from "../../test_utils/compare_contracts";
import { toCommentTable } from "../../test_utils/logs";
import {
  coerceArray,
  CompileHelper,
  DebugLogger,
  getAllFilesInDirectory,
  getCommonBasePath,
  getRelativePath,
  isDirectory,
  mkdirIfNotExists,
  optimizedCompilerOptions,
  StructuredText,
  UserCompilerOptions,
  writeFilesTo,
  writeNestedStructure
} from "../../utils";

export const generateCoders: CommandModule = {
  command: "$0 <input> [output]",
  describe: writeNestedStructure([
    "Generate ABI decoding library for all input/output types of external functions in a smart contract",
    "and modify the contract to use a function switch."
  ]),
  builder: {
    input: {
      alias: ["i"],
      describe: "Input Solidity file.",
      demandOption: true,
      coerce: path.resolve
    },
    output: {
      alias: ["o"],
      describe: "Output directory, defaults to directory of input.",
      demandOption: false,
      coerce: path.resolve
    },
    decoderOnly: {
      alias: ["d"],
      describe: "Only generate ABI decoding library without modifying the contract.",
      default: false,
      type: "boolean"
    },
    ir: {
      alias: ["y"],
      describe: "Also generate irOptimized for contract.",
      default: false,
      type: "boolean"
    },
    irUnoptimized: {
      alias: ["u"],
      describe: "Also generate unoptimized IR.",
      default: false,
      type: "boolean"
    },
    verbose: {
      alias: ["v"],
      describe: "Keep the constructor and sourcemap comments in IR output.",
      default: false,
      type: "boolean"
    }
  },
  handler: async ({ decoderOnly, irUnoptimized: unoptimized, ir: irFlag, verbose, ...args }) => {
    const { basePath, output, fileName, helper } = await handlePathArgs(args);

    const logger = new DebugLogger();
    upgradeSourceCoders(helper, fileName, { functionSwitch: !decoderOnly }, logger);

    if (unoptimized || irFlag) {
      mkdirIfNotExists(output);
      console.log(`re-compiling for IR output...`);
      helper.recompile(true);

      const contract = helper.getContractForFile(fileName);
      const { ir, irOptimized, name } = contract;
      if (!irOptimized) {
        throw Error(
          `Contract ${name} has no intermediate representation - it is likely an interface or abstract contract`
        );
      }
      const files = [[`${name}.optimized.yul`, irOptimized]];
      if (unoptimized) {
        files.push([`${name}.yul`, ir]);
      }
      for (const [irFileName, irOutput] of files) {
        const data = verbose ? irOutput : cleanIR(irOutput);
        const filePath = path.join(output, irFileName);
        writeFileSync(filePath, data);
      }
    }
    console.log(`writing files...`);
    const files = helper.getFiles();
    if (output === basePath /* && !decoderOnly */) {
      const suffix = decoderOnly ? `WithDecoders.sol` : `WithDecodersAndSwitch.sol`;
      const newFileName = fileName.replace(".sol", suffix);
      renameFile(fileName, newFileName, files);
      // throw Error(`Output can not match basePath when decoderOnly is false.`);
    }
    writeFilesTo(output, files);
    console.log(`done!`);
  }
};
