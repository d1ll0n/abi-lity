// new RegExp("(?<![a-z])(" + toCamelCase(word) +  ")(s?)(!?[A-Z])", 'g')
// new RegExp("(?<![A-Z])(" + toPascalCase(word) +  ")(s?)(!?[a-z])", 'g')
// /(?<![A-Z])(Vault)(s?)(?![a-z])/g

import { snakeCaseToCamelCase, snakeCaseToPascalCase } from "../../../codegen/names";
import path from "path";
import { Argv } from "yargs";
import { JsonFragment } from "@ethersproject/abi";
import { getAllFilesInDirectory, writeNestedStructure } from "../../../utils";
import { FunctionType } from "../../../ast";
import { toCommentTable } from "../../../test_utils/logs";
import { isExternalFunctionDefinitionOrType } from "../../../codegen";
import { readTypeNodesFromABI, readTypeNodesFromSolidity } from "../../../readers";
import { resolveSolidityFiles } from "../../../utils";
import { readFileSync } from "fs";

const options = {
  input: {
    alias: ["i"],
    describe: "Input directory.",
    demandOption: true,
    coerce: path.resolve
  },
  search: {
    alias: ["s"],
    describe: "Text to search for - must be in snake case",
    type: "string",
    demandOption: true
  },
  replace: {
    alias: ["r"],
    describe: "Text to replace with - must be in snake case",
    type: "string",
    demandOption: true
  },
  output: {
    alias: ["o"],
    describe: "Output directory, defaults to directory of input.",
    demandOption: false,
    coerce: path.resolve
  },
  excludeFileNames: {
    alias: ["f"],
    describe: "Exclude file names in search",
    type: "boolean",
    default: false
  }
} as const;

export const addCommand = <T>(yargs: Argv<T>): Argv<T> =>
  yargs.command(
    "rename <input> [output] [search] [replace]",
    writeNestedStructure(["Replace a word in a solidity directory"]),
    options,
    async ({ input, output, search, replace, excludeFileNames }) => {
      const relativeFilePaths = getAllFilesInDirectory(input, ".sol");
      const replaceFn = getReplaceFunction(search, replace);
      const files: Map<string, string> = new Map();
      const fileReplaceCounter = { count: 0 };

      for (const relativePath of relativeFilePaths) {
        const filePath = path.join(input, relativePath);
        const content = replaceFn(readFileSync(filePath, "utf8"));
        if (excludeFileNames) {
          files.set(relativePath, content);
        } else {
          const { base, dir } = path.parse(relativePath);
          const renamedRelativePath = path.join(dir, replaceFn(base));
          if (files.has(renamedRelativePath)) {
            throw Error(`Conflict in renamed file path: duplicate ${renamedRelativePath}`);
          }
          files.set(renamedRelativePath, content);
        }
      }
    }
  );

function getReplaceFunction(
  searchText: string,
  replaceText: string,
  counter?: { count: number }
): (text: string) => string {
  if (searchText.toLowerCase() !== searchText || replaceText.toLowerCase() !== replaceText) {
    throw Error(`Provided search and replace text must be in snake_case`);
  }

  const pascalRegex = new RegExp("(" + snakeCaseToPascalCase(searchText) + ")(s?)(?![a-z])", "g");
  const camelRegex = new RegExp(
    "(?<![a-z])(" + snakeCaseToCamelCase(searchText) + ")(s?)(!?[a-z])",
    "g"
  );
  const upperRegex = new RegExp(
    "(?<![A-Z])(" + searchText.toUpperCase().replaceAll("_", "") + ")(S?)(!?[A-Z])",
    "g"
  );
  const pascalReplace = snakeCaseToPascalCase(replaceText);
  const camelReplace = snakeCaseToCamelCase(replaceText);
  const upperReplace = replaceText.toUpperCase().replaceAll("_", "");

  return (text: string) =>
    text
      .replace(pascalRegex, (__, _, suffix) => {
        counter && counter.count++;
        return pascalReplace + suffix;
      })
      .replace(camelRegex, (__, _, suffix) => {
        counter && counter.count++;
        return camelReplace + suffix;
      })
      .replace(upperRegex, (__, _, suffix) => {
        counter && counter.count++;
        return upperReplace + suffix;
      });
}
