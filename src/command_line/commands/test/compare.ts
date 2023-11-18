import path from "path";
import { Argv } from "yargs";
import { writeNestedStructure } from "../../../utils";
import { getCommandLineInputPaths } from "../../utils2";
import { getAllContractDeployments, testDeployments } from "../../../test_utils/compare_contracts";

const options = {
  input: {
    alias: ["i"],
    describe: "Input Solidity or JSON file.",
    demandOption: true,
    coerce: path.resolve
  },
  ir: {
    alias: ["y"],
    describe: "Also generate irOptimized for contract.",
    default: false,
    type: "boolean"
  }
} as const;

export const addCommand = <T>(yargs: Argv<T>): Argv<T> =>
  yargs.command(
    "compare <input>",
    writeNestedStructure([
      "Compare gas and codesize of contracts with different implementations",
      "of the same functions."
    ]),
    options,
    async (args) => {
      const { basePath, output, fileName, helper } = await getCommandLineInputPaths(
        args,
        true,
        {
          viaIR: true,
          optimizer: true,
          runs: "max"
        },
        "TESTS"
      );
      const deployments = await getAllContractDeployments(helper);
      await testDeployments(deployments);
    }
  );
