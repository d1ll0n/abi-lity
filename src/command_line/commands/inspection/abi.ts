// import path from "path";
// import { Argv } from "yargs";
// import { JsonFragment } from "@ethersproject/abi";
// import { writeNestedStructure } from "../../../utils";
// import { FunctionType } from "../../../ast";
// import { toCommentTable } from "../../../test_utils/logs";
// import { isExternalFunctionDefinitionOrType } from "../../../codegen";
// import { readTypeNodesFromABI, readTypeNodesFromSolidity } from "../../../readers";
// import { resolveSolidityFiles } from "../../../utils";
// import { getCommandLineInputPaths } from "../../utils2";

// const options = {
//   input: {
//     alias: ["i"],
//     describe: "Input Solidity or JSON file.",
//     demandOption: true,
//     coerce: path.resolve
//   },
//   name: {
//     alias: ["n"],
//     describe: "Function name to print selector for",
//     type: "string",
//     demandOption: false
//   },
//   output: {
//     alias: ["o"],
//     describe: "Output directory or file, defaults to directory of input.",
//     demandOption: false,
//     coerce: path.resolve
//   }
// } as const;

// export const addCommand = <T>(yargs: Argv<T>): Argv<T> =>
//   yargs.command(
//     "abi <input> <output> [name]",
//     writeNestedStructure(["Generate function selectors for external functions in a contract"]),
//     options,
//     async (args) => {
//       const { basePath, output, fileName, helper } = await getCommandLineInputPaths(
//         args,
//         false,
//         {
//           optimizer: false
//         },
//         "ABI"
//       );

//       const contractNames = args.name ? [args.name] : helper.contractsMap.keys();
//       const abi =

//       let contract;
//       if (name)
//         if (name) {
//           if (name.includes("(")) {
//             foundFunctions = types.filter((fn) => fn.functionSignature === name);
//           } else {
//             foundFunctions = types.filter((fn) => fn.name === name);
//           }
//           if (foundFunctions.length === 0) {
//             throw Error(`No function found for ${name}`);
//           }
//         } else {
//           foundFunctions = types;
//           if (foundFunctions.length === 0) {
//             throw Error(`No functions found`);
//           }
//         }
//       printFunctions(foundFunctions);
//     }
//   );
