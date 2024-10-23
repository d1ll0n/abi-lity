import { writeFileSync } from "fs";
import path from "path";
import { Argv } from "yargs";
import { CompileHelper, getRelativePath, writeNestedStructure } from "../../../utils";
import { ContractDefinition, FunctionDefinition, LatestCompilerVersion } from "solc-typed-ast";
import { functionDefinitionToTypeNode, readTypeNodesFromSolcAST } from "../../../readers";
import { StructType, TupleType } from "../../../ast";
import { isExternalFunctionDefinitionOrType } from "../../../codegen";
import { createCalldataCopiers, testCopiers } from "../../../test_utils";
import { writeCompilerOptions } from "../../utils2";

const options = {
  input: {
    alias: ["i"],
    describe: "Input Solidity or JSON file.",
    demandOption: true,
    coerce: path.resolve
  },
  output: {
    alias: ["o"],
    describe: "Output directory, defaults to directory of input.",
    demandOption: false,
    coerce: path.resolve
  },
  ir: {
    alias: ["y"],
    describe: "Also generate irOptimized for contract.",
    default: false,
    type: "boolean"
  },
  runs: {
    alias: ["r"],
    default: 200_000,
    describe: "Optimizer runs. Either a number of 'max'"
  },
  optimize: {
    alias: ["optimize"],
    describe: "Whether to enable compiler optimizations.",
    default: true,
    type: "boolean"
  },
  noIR: {
    alias: ["no-ir"],
    describe: "Do not use viaIR when testing.",
    default: false,
    type: "boolean"
  }
} as const;

export const addCommand = <T>(yargs: Argv<T>): Argv<T> =>
  yargs.command(
    "copy-test <input> [output]",
    writeNestedStructure([
      "Generate copy contract for types in a file as well as an optimized versions",
      "with abi-lity encoders and a version with a function switch, then test all copy",
      "functions in all three contracts and compare gas and code size."
    ]),
    options,
    async ({ input, output, ir, optimize, runs: r, noIR }) => {
      const runs = r as number | "max";
      if (!path.isAbsolute(input) || path.extname(input) !== ".sol") {
        throw Error(`${input} is not a Solidity file or was not found.`);
      }
      let basePath = path.dirname(input);

      let fileName = path.parse(input).base;
      console.log(`compiling ${fileName}...`);
      const helper = await CompileHelper.fromFileSystem(LatestCompilerVersion, fileName, basePath);
      basePath = helper.basePath as string;
      fileName = getRelativePath(basePath, input);
      const sourceUnit = helper.getSourceUnit(fileName);
      const types: Array<StructType | TupleType> = [];
      const contract = sourceUnit.getChildrenByType(ContractDefinition)[0];
      if (contract) {
        const functions = contract
          .getChildrenByType(FunctionDefinition)
          .filter(isExternalFunctionDefinitionOrType)
          .map(fn => functionDefinitionToTypeNode(fn));
        const tuples = functions.map((fn) => fn.parameters).filter(Boolean) as TupleType[];
        types.push(...tuples);
      } else {
        const { structs } = readTypeNodesFromSolcAST(true, sourceUnit);
        types.push(...structs);
      }
      const copyHelpers = await createCalldataCopiers(types, {
        optimizer: optimize,
        runs,
        viaIR: !noIR
      });
      await testCopiers(copyHelpers, types);
      console.log(writeCompilerOptions(copyHelpers.compilerOptions));
      if (output) {
        copyHelpers.writeFilesTo(output);
        if (ir) {
          const contracts = [...copyHelpers.contractsMap.entries()];
          if (contracts.length < 3) {
            throw Error(`Unexpected number of contracts`);
          }
          for (const [name, contract] of contracts) {
            writeFileSync(
              path.join(output, name.replace(`.sol`, `.optimized.yul`)),
              contract.irOptimized
            );
          }
        }
      }
    }
  );
