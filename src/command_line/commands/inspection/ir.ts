import { writeFileSync } from "fs";
import path from "path";
import { Argv } from "yargs";
import { cleanIR } from "../../../codegen/utils";
import { CompileHelper, mkdirIfNotExists, writeNestedStructure } from "../../../utils";
import { printCodeSize } from "../../utils";
import { LatestCompilerVersion } from "solc-typed-ast";

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
  },
  runs: {
    alias: ["r"],
    default: 200,
    describe: "Optimizer runs. Either a number of 'max'"
  }
} as const;

export const addCommand = <T>(yargs: Argv<T>): Argv<T> =>
  yargs.command(
    "ir <input> [output]",
    writeNestedStructure([
      "Generate the IR output for a Solidity contract.",
      `By default, only writes irOptimized and strips out all sourcemap comments.`
    ]),
    options,
    async ({ input, output, unoptimized, verbose, runs: r }) => {
      const runs = r as number | "max";
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
        true,
        { runs }
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
      printCodeSize(helper, fileName);
    }
  );
