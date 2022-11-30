#!/usr/bin/env node
import { writeFileSync } from "fs";
import path from "path";
import { ContractDefinition, LatestCompilerVersion } from "solc-typed-ast";
import yargs from "yargs";
import { buildDecoderFile, replaceExternalFunctionReferenceTypeParameters } from "./codegen";
import { getFunctionSelectorSwitch } from "./codegen/function_switch";
import { cleanIR } from "./codegen/utils";
import {
  CompileHelper,
  getCommonBasePath,
  getRelativePath,
  mkdirIfNotExists,
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
  mkdirIfNotExists(output);
  let fileName = path.parse(input).base;
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
      const { basePath, input, output, fileName, helper } = await handlePathArgs(args);
      if (output === basePath && !decoderOnly) {
        throw Error(`Output can not match basePath when decoderOnly is false.`);
      }
      const ctx = buildDecoderFile(helper, fileName);
      const sourceUnit = helper.getSourceUnit(fileName);
      replaceExternalFunctionReferenceTypeParameters(sourceUnit, ctx.decoderSourceUnit);
      const contractDefinition = sourceUnit.getChildrenByType(ContractDefinition)[0];

      if (!contractDefinition) {
        throw Error(`No contracts found in ${fileName}`);
      }
      if (!decoderOnly) {
        getFunctionSelectorSwitch(contractDefinition, ctx.decoderSourceUnit);
      }

      if (unoptimized || irFlag) {
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

      const files = helper.getFiles();
      writeFilesTo(output, files);
    }
  )
  .help("h")
  .fail(function (msg, err) {
    console.error(`Error: ${err.message}`);
    throw err;
  }).argv;
