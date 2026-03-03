import { writeFileSync } from "fs";
import path from "path";
import { Argv } from "yargs";
import { DebugLogger, mkdirIfNotExists, writeNestedStructure } from "../../../utils";
import { assert } from "solc-typed-ast";
import { getCommandLineInputPaths } from "../../utils2";
import { WrappedSourceUnit } from "../../../codegen/ctx/contract_wrapper";
import { generateForgeTestShim } from "../../../codegen/test-shim/generate";

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
  fuzz: {
    alias: ["f"],
    describe: "Generate fuzz tests",
    type: "boolean",
    default: true
  },
  concrete: {
    describe: "Generate concrete tests",
    type: "boolean",
    default: true
  },
  failures: {
    describe: "Generate failure tests",
    type: "boolean",
    default: true
  }
} as const;

/**
 * Registers the `shim` CLI command that generates Forge test shim contracts
 * for a given Solidity contract. The test shim provides fuzz, concrete, and
 * failure test scaffolding.
 *
 * Options:
 * - `--fuzz` / `-f`: Generate fuzz tests (default true)
 * - `--concrete`: Generate concrete tests (default true)
 * - `--failures`: Generate failure tests (default true)
 *
 * Note: The command description is copy-pasted from `forge-json` and reads
 * "Generate JSON serializers for forge" — this is incorrect.
 */
export const addCommand = <T>(yargs: Argv<T>): Argv<T> =>
  yargs.command(
    "shim <input> [output]",
    writeNestedStructure(["Generate JSON serializers for forge"]),
    options,
    async (args) => {
      const { basePath, output, fileName, helper } = await getCommandLineInputPaths(args, false);

      const logger = new DebugLogger();
      mkdirIfNotExists(output);
      const sourceUnit = helper.getSourceUnit(fileName);
      const contract = sourceUnit.vContracts[0];
      assert(contract !== undefined, `No contract found in ${fileName}`);
      const primaryFileName = path.basename(fileName.replace(".sol", ".t.sol"));
      const primaryFilePath = path.join(output, primaryFileName);

      const ctx = WrappedSourceUnit.getWrapper(helper, primaryFileName, output);
      const testCode = generateForgeTestShim(ctx, contract, {
        concrete: args.concrete,
        failures: args.failures,
        fuzz: args.fuzz
      });
      writeFileSync(primaryFilePath, testCode);
    }
  );
