import path from "path";
import { Argv } from "yargs";
import { CompileHelper, writeNestedStructure } from "../../../utils";
import { printCodeSize } from "../../utils";
import { LatestCompilerVersion } from "solc-typed-ast";

const options = {
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
} as const;

/**
 * Registers the `size` CLI command that compiles a Solidity contract and prints
 * its runtime bytecode size in bytes, along with the distance from the 24,577-byte
 * contract size limit (EIP-170).
 *
 * Note: The `--creationCode` / `-c` option is defined but never used in the
 * handler — only runtime code size is reported regardless of this flag.
 */
export const addCommand = <T>(yargs: Argv<T>): Argv<T> =>
  yargs.command(
    "size <input>",
    writeNestedStructure([
      "Print the size in bytes of the runtime code of a contract.",
      "By default, prints the runtime code size when compiled with 20,000 optimizer runs."
    ]),
    options,
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
      printCodeSize(helper, fileName);
    }
  );
