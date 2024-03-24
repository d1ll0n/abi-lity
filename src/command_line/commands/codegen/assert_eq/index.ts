import path from "path";
import { Argv } from "yargs";
import {
  DebugLogger,
  mkdirIfNotExists,
  writeFilesTo,
  writeNestedStructure
} from "../../../../utils";
import { getCommandLineInputPaths } from "../../../utils";
import { generateAssertions } from "./generate";

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
    describe: "Struct to generate assertions for",
    type: "array"
  }
} as const;

export const addCommand = <T>(yargs: Argv<T>): Argv<T> =>
  yargs.command(
    "assert_eq <input> [output]",
    writeNestedStructure(["Generate forge equality assertions for Solidity types"]),
    options,
    async (args) => {
      const { basePath, output, fileName, helper } = await getCommandLineInputPaths(
        args,
        false,
        false,
        {
          optimizer: false,
          runs: 0,
          viaIR: false
        }
      );
      const logger = new DebugLogger();
      mkdirIfNotExists(output);
      const primaryFilePath = path.join(
        output,
        path.basename(fileName.replace(".sol", "Assertions.sol"))
      );
      generateAssertions(
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
      const newCode = writeNestedStructure([
        `import { StdAssertions } from "forge-std/StdAssertions.sol";`,
        `import { LibString } from "solady/src/utils/LibString.sol";`
      ]);
      const code = files.get(primaryFilePath) as string;
      files.clear();
      files.set(
        primaryFilePath,
        code.replace(`import "./Tmp_Assert.sol";`, newCode).replace(/assertEq\w+\(/g, "assertEq(")
      );
      writeFilesTo(output, files);
    }
  );
