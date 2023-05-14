import path from "path";
import { Argv } from "yargs";
import { JsonFragment } from "@ethersproject/abi";
import { writeNestedStructure } from "../../../utils";
import { FunctionType } from "../../../ast";
import { toCommentTable } from "../../../test_utils/logs";
import { isExternalFunctionDefinitionOrType } from "../../../codegen";
import { readTypeNodesFromABI, readTypeNodesFromSolidity } from "../../../readers";
import { resolveSolidityFiles } from "../../../utils";

const options = {
  input: {
    alias: ["i"],
    describe: "Input Solidity or JSON file.",
    demandOption: true,
    coerce: path.resolve
  },
  name: {
    alias: ["n"],
    describe: "Function name to print selector for",
    type: "string",
    demandOption: false
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
    "selectors <input> [name] [output]",
    writeNestedStructure(["Generate function selectors for external functions in a contract"]),
    options,
    async ({ input, output, name }) => {
      let types: FunctionType[] = [];
      if (path.extname(input).toLowerCase() === ".json") {
        const data = require(input);
        let abi: JsonFragment[];
        if (Array.isArray(data)) {
          abi = data;
        } else if (data["abi"]) {
          abi = data["abi"];
        } else {
          throw Error(
            writeNestedStructure([
              `ABI not found in ${input}`,
              `JSON input file must be ABI or artifact with "abi" member.`
            ])
          );
        }
        types = readTypeNodesFromABI(abi).functions;
      } else if (path.extname(input) === ".sol") {
        const { files, fileName } = resolveSolidityFiles(input);
        console.log({ fileName, input });
        const filePaths = [...files.keys()];
        filePaths.reverse();
        const code = filePaths.map((p) => files.get(p) as string).join("\n\n");

        types = readTypeNodesFromSolidity(code).functions;
      } else {
        throw Error(`Input file must be a .sol file or a JSON artifact or ABI file`);
      }
      types = types.filter(isExternalFunctionDefinitionOrType);

      const printFunctions = (functions: FunctionType[]) => {
        const id = functions.length > 1 || name?.includes("(") ? "functionSignature" : "name";
        const lines = functions.map((fn) => [fn.functionSelector, fn[id]]);
        if (functions.length > 1) {
          lines.unshift(["selector", id]);
          console.log(toCommentTable(lines).join("\n"));
        } else {
          console.log(lines[0].join(" : "));
        }
      };
      let foundFunctions: FunctionType[];
      if (name) {
        if (name.includes("(")) {
          foundFunctions = types.filter((fn) => fn.functionSignature === name);
        } else {
          foundFunctions = types.filter((fn) => fn.name === name);
        }
        if (foundFunctions.length === 0) {
          throw Error(`No function found for ${name}`);
        }
      } else {
        foundFunctions = types;
        if (foundFunctions.length === 0) {
          throw Error(`No functions found`);
        }
      }
      printFunctions(foundFunctions);
    }
  );
