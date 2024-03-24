import path from "path";
import { Argv } from "yargs";
import {
  DebugLogger,
  mkdirIfNotExists,
  writeFilesTo,
  writeNestedStructure
} from "../../../../utils";
import { getCommandLineInputPaths } from "../../../utils2";
import { generateContractType } from "./generate";

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
    demandOption: true,
    coerce: path.resolve
  },
  contract: {
    alias: ["c"],
    describe: "Name of the contract or interface to generate the type and library for",
    type: "string"
  },
  zeroUsedMemory: {
    alias: ["z"],
    describe: `Zero out any memory used past the free pointer`,
    default: false,
    type: "boolean"
  },
  skipBase: {
    alias: ["s"],
    describe: `Skip generating functions for inherited contracts`,
    default: false,
    type: "boolean"
  }
} as const;

export const addCommand = <T>(yargs: Argv<T>): Argv<T> =>
  yargs.command(
    "ctype <input> [output]",
    writeNestedStructure([
      "Generate a custom type for a contract or interface, with a library defining",
      `call functions for all its external methods that avoid memory allocation.`
    ]),
    options,
    async (args) => {
      const { output, fileName, helper } = await getCommandLineInputPaths(args, false, {
        optimizer: false,
        runs: 0,
        viaIR: false
      });
      mkdirIfNotExists(output);
      generateContractType(helper, fileName, args.contract, {
        skipBaseContracts: args.skipBase,
        zeroUsedMemory: args.zeroUsedMemory
      });
      console.log(`writing contract type library...`);
      const files = helper.getFiles();
      writeFilesTo(output, files);
    }
  );
