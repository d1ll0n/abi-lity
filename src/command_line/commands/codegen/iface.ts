import { writeFileSync } from "fs";
import path from "path";
import { Argv } from "yargs";
import {
  StructuredText,
  getAllFilesInDirectory,
  isDirectory,
  mkdirIfNotExists,
  writeNestedStructure
} from "../../../utils";
import { LatestCompilerVersion } from "solc-typed-ast";
import { getTypesFromCommandLineInputs } from "../../utils2";

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
  contract: {
    alias: ["c"],
    describe: "Contract(s) to generate interface for",
    type: "array",
    default: [] as string[]
  },
  noPrefix: {
    alias: ["np"],
    describe: "Do not prefix generated interface with I",
    type: "boolean",
    default: false
  }
} as const;

async function createInterfaceFile(args: {
  input: string;
  output: string | undefined;
  noPrefix: boolean;
}) {
  const { output, fileName, types } = await getTypesFromCommandLineInputs(args);
  mkdirIfNotExists(output);
  console.log(`Got ${Object.keys(types).length} types from ${fileName}`);
  Object.entries(types).forEach(([name, type]) => {
    name = args.noPrefix ? name : `I${name}`;
    const text: StructuredText[] = [
      `// SPDX-License-Identifier: MIT`,
      `pragma solidity ^${LatestCompilerVersion};`,
      "",
      ...type.enums.map((e) => [e.writeDefinition(), ""]).flat(),
      ...type.structs.map((e) => [...e.writeDefinition().split("\n"), ""]).flat(),
      `interface ${name} {`,
      [
        ...type.errors.map((e) => [e.writeDefinition() + ";", ""]).flat(),
        ...type.events.map((e) => [e.writeDefinition() + ";", ""]).flat(),
        ...type.functions
          .map((e, i) => {
            const ln = [e.writeDefinition() + ";"];
            if (i < type.functions.length - 1) {
              ln.push("");
            }
            return ln;
          })
          .flat()
      ],
      "}"
    ];
    const file = writeNestedStructure(text);
    writeFileSync(path.join(output, `${name}.sol`), file);
  });
}

export const addCommand = <T>(yargs: Argv<T>): Argv<T> =>
  yargs.command(
    "iface <input> [output]",
    writeNestedStructure(["Generate interface for smart contract"]),
    options,
    async ({ contract, ...args }) => {
      if (isDirectory(args.input)) {
        const dir = args.input;
        const children = getAllFilesInDirectory(dir, ".json")
          .filter((f) => contract.includes(path.basename(f).replace(".json", "")))
          .map((p) => path.join(dir, p));
        await Promise.all(
          children.map((child) => {
            createInterfaceFile({ ...args, input: child });
          })
        );
      } else {
        await createInterfaceFile(args);
      }
      /*       const { basePath, output, fileName, types } = await getTypesFromCommandLineInputs(args);
      mkdirIfNotExists(output);
      console.log(`Got ${Object.keys(types).length} types from ${fileName}`);
      Object.entries(types).forEach(([name, type]) => {
        const text: StructuredText[] = [
          `// SPDX-License-Identifier: MIT`,
          `pragma solidity ^${LatestCompilerVersion};`,
          "",
          ...type.enums.map((e) => [e.writeDefinition(), ""]).flat(),
          ...type.structs.map((e) => [...e.writeDefinition().split("\n"), ""]).flat(),
          `interface I${name} {`,
          [
            ...type.errors.map((e) => [e.writeDefinition() + ";", ""]).flat(),
            ...type.events.map((e) => [e.writeDefinition() + ";", ""]).flat(),
            ...type.functions
              .map((e, i) => {
                const ln = [e.writeDefinition() + ";"];
                if (i < type.functions.length - 1) {
                  ln.push("");
                }
                return ln;
              })
              .flat()
          ],
          "}"
        ];
        const file = writeNestedStructure(text);
        writeFileSync(path.join(output, `I${name}.sol`), file);
      }); */
    }
  );
