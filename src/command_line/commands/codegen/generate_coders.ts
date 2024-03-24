import { writeFileSync } from "fs";
import path from "path";
import { Argv } from "yargs";
import { UpgradeCoderOptions, upgradeSourceCoders } from "../../../codegen/coders/generate";
import { cleanIR } from "../../../codegen/utils";
import { DebugLogger, mkdirIfNotExists, writeFilesTo, writeNestedStructure } from "../../../utils";
import { getCommandLineInputPaths, renameFile } from "../../utils2";
import _ from "lodash";

const options = {
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
  },
  only: {
    describe: writeNestedStructure([
      "Only generate the specified coders.",
      ["return", "revert", "hash", "emit", "encode", "state"].join(", ")
    ]),
    array: true,
    type: "array"
  }
} as const;

const optionsMap = {
  return: "replaceReturnStatements",
  revert: "replaceRevertCalls",
  hash: "replaceHashCalls",
  emit: "replaceEmitCalls",
  encode: "replaceAbiEncodeCalls",
  state: "replaceStateVariables"
} as const;

const getOptions = (
  decoderOnly: boolean,
  only: Array<keyof typeof optionsMap> = []
): UpgradeCoderOptions => {
  if (!only.length) {
    return {
      functionSwitch: !decoderOnly,
      replaceReturnStatements: true,
      replaceRevertCalls: true,
      replaceHashCalls: true,
      replaceEmitCalls: true,
      replaceAbiEncodeCalls: true,
      replaceStateVariables: true
    };
  }

  const opts: UpgradeCoderOptions = {};
  for (const option of only) {
    opts[optionsMap[option]] = true;
  }
  return opts;
};

const defaultOptions = {
  functionSwitch: true,
  replaceReturnStatements: true,
  replaceRevertCalls: true,
  replaceHashCalls: true,
  replaceEmitCalls: true,
  replaceAbiEncodeCalls: true,
  replaceStateVariables: true
};

if (
  !_.isEqual(getOptions(false), defaultOptions) ||
  !_.isEqual(getOptions(false, []), defaultOptions) ||
  !_.isEqual(getOptions(true), { ...defaultOptions, functionSwitch: false })
) {
  throw Error("getOptions is broken");
}

export const addCommand = <T>(yargs: Argv<T>): Argv<T> =>
  yargs.command(
    "$0 <input> [output]",
    writeNestedStructure([
      "Generate ABI decoding library for all input/output types of external functions in a smart contract",
      "and modify the contract to use a function switch."
    ]),
    options,
    async ({
      decoderOnly,
      irUnoptimized: unoptimized,
      ir: irFlag,
      verbose,
      ...args
    }): Promise<void> => {
      const { basePath, output, fileName, helper } = await getCommandLineInputPaths(args, false, {
        viaIR: true
      });
      const only = args.only as Array<keyof typeof optionsMap> | undefined;
      console.log({ only, decoderOnly });
      const options = getOptions(decoderOnly, only);
      console.log(options);

      const logger = new DebugLogger();
      upgradeSourceCoders(
        helper,
        fileName,
        options,
        // {
        //   functionSwitch: !decoderOnly,
        //   replaceReturnStatements: true,
        //   replaceRevertCalls: true,
        //   replaceHashCalls: true,
        //   replaceEmitCalls: true,
        //   replaceAbiEncodeCalls: true,
        //   replaceStateVariables: true
        // },
        logger
      );

      if (unoptimized || irFlag) {
        mkdirIfNotExists(output);
        console.log(`re-compiling for IR output...`);
        helper.recompile();

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
    }
  );
