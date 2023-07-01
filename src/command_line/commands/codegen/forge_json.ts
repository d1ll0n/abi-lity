import path from "path";
import { Argv } from "yargs";
import { DebugLogger, mkdirIfNotExists, writeFilesTo, writeNestedStructure } from "../../../utils";
import { generateJsonSerializers } from "../../../codegen";
import { getCommandLineInputPaths } from "../../utils2";

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
    "forge-json <input> [output]",
    writeNestedStructure(["Generate JSON serializers for forge"]),
    options,
    async (args) => {
      const { basePath, output, fileName, helper } = await getCommandLineInputPaths(
        args,
        false,
        undefined,
        "CODEGEN"
      );
      const logger = new DebugLogger();
      mkdirIfNotExists(output);
      const primaryFilePath = path.join(
        output,
        path.basename(fileName.replace(".sol", "Serializers.sol"))
      );
      generateJsonSerializers(
        helper,
        fileName,
        {
          outPath: output,
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
