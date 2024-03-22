import path from "path";
import { Argv } from "yargs";
import { DebugLogger, writeFilesTo, writeNestedStructure } from "../../../utils";
import { getCommandLineInputPaths, renameFile } from "../../utils2";
import { addExternalWrappers } from "../../../codegen";

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
  }
} as const;

export const addCommand = <T>(yargs: Argv<T>): Argv<T> =>
  yargs.command(
    "wrappers <input> [output]",
    writeNestedStructure(["Generate external wrappers for free/library functions in a file."]),
    options,
    async (args) => {
      const { basePath, output, fileName, helper } = await getCommandLineInputPaths(args);

      const logger = new DebugLogger();
      addExternalWrappers(helper, fileName, logger);

      console.log(`writing files...`);
      const files = helper.getFiles();
      if (output === basePath /* && !decoderOnly */) {
        const suffix = `ExternalFile.sol`;
        const newFileName = fileName.replace(".sol", suffix);
        renameFile(fileName, newFileName, files);
      }
      writeFilesTo(output, files);
      console.log(`done!`);
    }
  );
