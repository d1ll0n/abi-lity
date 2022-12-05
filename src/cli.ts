#!/usr/bin/env node
import { writeFileSync } from "fs";
import path from "path";
import { ContractDefinition, FunctionDefinition, LatestCompilerVersion } from "solc-typed-ast";
import yargs from "yargs";
import { StructType, TupleType } from "./ast";
import { isExternalFunction } from "./codegen";
import { upgradeSourceCoders } from "./codegen/generate";
import { cleanIR } from "./codegen/utils";
import { functionDefinitionToTypeNode, readTypeNodesFromSolcAST } from "./readers";
import { createCalldataCopiers, testCopiers } from "./test_utils";
import {
  CompileHelper,
  DebugLogger,
  getCommonBasePath,
  getRelativePath,
  mkdirIfNotExists,
  StructuredText,
  writeFilesTo,
  writeNestedStructure
} from "./utils";

async function handlePathArgs({ input, output }: { input: string; output?: string }) {
  if (!path.isAbsolute(input) || path.extname(input) !== ".sol") {
    throw Error(`${input} is not a Solidity file or was not found.`);
  }
  let basePath = path.dirname(input);
  if (!output) {
    output = basePath;
  }
  let fileName = path.parse(input).base;
  console.log(`compiling...`);
  const helper = await CompileHelper.fromFileSystem(
    LatestCompilerVersion,
    fileName,
    basePath,
    true
  );

  basePath = helper.basePath as string;
  fileName = getRelativePath(basePath, input);
  return {
    basePath,
    fileName,
    input,
    output,
    helper
  };
}

function renameFile(oldFileName: string, newFileName: string, files: Map<string, string>) {
  const filePaths = [...files.keys()];
  const basePath = getCommonBasePath(filePaths);
  if (!basePath) {
    throw Error(`No common base path in files ${filePaths.join(", ")}`);
  }
  const oldFilePath = path.join(basePath, oldFileName);
  const newFilePath = path.join(basePath, newFileName);
  const oldFile = files.get(oldFilePath);
  files.delete(oldFilePath);
  files.set(newFilePath, oldFile as string);
  for (const filePath of filePaths) {
    if (filePath !== oldFilePath) {
      const oldRelativePath = getRelativePath(filePath, oldFilePath);
      const newRelativePath = getRelativePath(filePath, newFilePath);
      const file = files.get(filePath) as string;
      files.set(filePath, file.replaceAll(oldRelativePath, newRelativePath));
    }
  }
}

yargs
  .command(
    "ir <input> [output]",
    writeNestedStructure([
      "Generate the IR output for a Solidity contract.",
      `By default, only writes irOptimized and strips out all sourcemap comments.`
    ]),
    {
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
      unoptimized: {
        alias: ["u"],
        describe: "Also generate unoptimized IR.",
        default: false,
        type: "boolean"
      },
      verbose: {
        alias: ["v"],
        describe: "Keep the constructor and sourcemap comments.",
        default: false,
        type: "boolean"
      }
    },
    async ({ input, output, unoptimized, verbose }) => {
      if (!path.isAbsolute(input) || path.extname(input) !== ".sol") {
        throw Error(`${input} is not a Solidity file or was not found.`);
      }
      const basePath = path.dirname(input);
      if (!output) {
        output = basePath;
      }
      mkdirIfNotExists(output);
      const fileName = path.parse(input).base;
      const helper = await CompileHelper.fromFileSystem(
        LatestCompilerVersion,
        fileName,
        basePath,
        true
      );
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
  )
  .command(
    "$0 <input> [output]",
    writeNestedStructure([
      "Generate ABI decoding library for all input/output types of external functions in a smart contract",
      "and modify the contract to use a function switch."
    ]),
    {
      input: {
        alias: ["i"],
        describe: "Input Solidity file.",
        demandOption: true,
        coerce: path.resolve
      },
      output: {
        alias: ["o"],
        describe: "Output directory, defaults to directory of input.",
        demandOption: true,
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
    async ({ decoderOnly, irUnoptimized: unoptimized, ir: irFlag, verbose, ...args }) => {
      const { basePath, output, fileName, helper } = await handlePathArgs(args);
      if (output === basePath && !decoderOnly) {
        throw Error(`Output can not match basePath when decoderOnly is false.`);
      }
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
      writeFilesTo(output, files);
      console.log(`done!`);
    }
  )
  .command(
    "size <input>",
    writeNestedStructure([
      "Print the size in bytes of the runtime code of a contract.",
      "By default, prints the runtime code size when compiled with 20,000 optimizer runs."
    ]),
    {
      input: {
        alias: ["i"],
        describe: "Input Solidity file.",
        demandOption: true,
        coerce: path.resolve
      },
      unoptimized: {
        alias: ["u"],
        describe: "Print the unoptimized code size.",
        default: false,
        type: "boolean"
      },
      creationCode: {
        alias: ["c"],
        describe: "Print the creation code size.",
        default: false,
        type: "boolean"
      }
    },
    async ({ input, unoptimized }) => {
      if (!path.isAbsolute(input) || path.extname(input) !== ".sol") {
        throw Error(`${input} is not a Solidity file or was not found.`);
      }
      const basePath = path.dirname(input);
      const fileName = path.parse(input).base;
      const helper = await CompileHelper.fromFileSystem(
        LatestCompilerVersion,
        fileName,
        basePath,
        !unoptimized
      );
      const contract = helper.getContractForFile(fileName);
      const contractCode = contract.runtimeCode;
      if (!contractCode) {
        throw Error(
          `Compiled contract has no code - it is likely an interface or abstract contract`
        );
      }
      const codeBuffer = Buffer.from(contractCode, "hex");
      const codeSize = codeBuffer.byteLength;
      const output: StructuredText[] = [`Runtime code size: ${codeSize} bytes`];
      const maxSize = 24577;
      const diff = maxSize - codeSize;
      if (diff > 0) {
        output.push(`${diff} bytes below contract size limit`);
      } else if (diff === 0) {
        output.push(`Exactly at contract size limit`);
      } else {
        output.push(`${-diff} bytes over contract size limit`);
      }

      console.log(
        writeNestedStructure([
          `Contract: ${contract.name}`,
          [
            ...output,
            `Settings:`,
            [
              `Version: ${LatestCompilerVersion}`,
              `viaIR: true`,
              unoptimized ? `Optimizer Off` : `Optimizer Runs: 20000`
            ]
          ]
        ])
      );
    }
  )
  .command(
    "copy-test <input> [output]",
    writeNestedStructure([
      "Generate copy contract for types in a file as well as an optimized versions",
      "with abi-lity encoders and a version with a function switch, then test all copy",
      "functions in all three contracts and compare gas and code size."
    ]),
    {
      input: {
        alias: ["i"],
        describe: "Input Solidity or JSON file.",
        demandOption: true,
        coerce: path.resolve
      },
      output: {
        alias: ["o"],
        describe: "Output directory, defaults to directory of input.",
        demandOption: false,
        coerce: path.resolve
      },
      ir: {
        alias: ["y"],
        describe: "Also generate irOptimized for contract.",
        default: false,
        type: "boolean"
      }
    },
    async ({ input, output, ir }) => {
      if (!path.isAbsolute(input) || path.extname(input) !== ".sol") {
        throw Error(`${input} is not a Solidity file or was not found.`);
      }
      let basePath = path.dirname(input);

      let fileName = path.parse(input).base;
      console.log(`compiling ${fileName}...`);
      const helper = await CompileHelper.fromFileSystem(
        LatestCompilerVersion,
        fileName,
        basePath,
        true
      );
      basePath = helper.basePath as string;
      fileName = getRelativePath(basePath, input);
      const sourceUnit = helper.getSourceUnit(fileName);
      const types: Array<StructType | TupleType> = [];
      const contract = sourceUnit.getChildrenByType(ContractDefinition)[0];
      if (contract) {
        const functions = contract
          .getChildrenByType(FunctionDefinition)
          .filter(isExternalFunction)
          .map(functionDefinitionToTypeNode);
        const tuples = functions.map((fn) => fn.parameters).filter(Boolean) as TupleType[];
        types.push(...tuples);
      } else {
        const { structs } = readTypeNodesFromSolcAST(sourceUnit);
        types.push(...structs);
      }
      const copyHelpers = await createCalldataCopiers(types);
      await testCopiers(copyHelpers, types);
      if (output) {
        copyHelpers.writeFilesTo(output);
        if (ir) {
          const contracts = [...copyHelpers.contractsMap.entries()];
          if (contracts.length < 3) {
            throw Error(`Unexpected number of contracts`);
          }
          for (const [name, contract] of contracts) {
            writeFileSync(
              path.join(output, name.replace(`.sol`, `.optimized.yul`)),
              contract.irOptimized
            );
          }
        }
      }
    }
  )
  .help("h")
  .fail(function (msg, err) {
    console.error(`Error: ${err.message}`);
    throw err;
  }).argv;
