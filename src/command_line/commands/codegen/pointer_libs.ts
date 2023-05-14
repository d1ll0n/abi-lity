import path from "path";
import { Argv } from "yargs";
import { DebugLogger, writeFilesTo, writeNestedStructure } from "../../../utils";
import { getCommandLineInputPaths } from "../../utils";
import { buildPointerFiles } from "../../../codegen/type_libraries/generate";

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
    "ptr-libs <input> [output]",
    writeNestedStructure(["Generate pointer libraries for structs"]),
    options,
    async (args) => {
      const { output, fileName, helper } = await getCommandLineInputPaths(args, false, false, {
        optimizer: false,
        runs: 0,
        viaIR: false
      });
      const logger = new DebugLogger();
      const { ctx, functions } = buildPointerFiles(helper, fileName, undefined, output, logger);
      const files = ctx.getNewFiles();
      writeFilesTo(output, files);
      if (files.size > 3) {
        logger.log(`generated pointer libraries for ${functions.length} functions`);
      }
    }
  );
