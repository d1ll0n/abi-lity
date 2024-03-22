import path from "path";
import { Argv } from "yargs";
import {
  DebugLogger,
  mkdirIfNotExists,
  writeFilesTo,
  writeNestedStructure
} from "../../../../utils";
import { getCommandLineInputPaths } from "../../../utils2";
import { generateJsonSerializers } from "./generate";

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
  struct: {
    alias: ["s"],
    describe: "Struct to generate serializers for",
    type: "array"
  }
} as const;

export const addCommand = <T>(yargs: Argv<T>): Argv<T> =>
  yargs.command(
    "json <input> [output]",
    writeNestedStructure(["Generate JSON serializers for Solidity types"]),
    options,
    async (args) => {
      const { basePath, output, fileName, helper } = await getCommandLineInputPaths(args, false, {
        optimizer: false,
        runs: 0,
        viaIR: false
      });
      const logger = new DebugLogger();
      mkdirIfNotExists(output);
      const primaryFilePath = path.basename(fileName.replace(".sol", "Serializers.sol"));
      generateJsonSerializers(
        helper,
        fileName,
        {
          // outPath: output,
          decoderFileName: primaryFilePath
        },
        args.struct as string | string[],
        logger
      );
      console.log(`writing serializer...`);
      const files = helper.getFiles();
      writeFilesTo(output, files);
      console.log(`done!`);
    }
  );
