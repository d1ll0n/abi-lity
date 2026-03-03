/**
 * @module command_line/utils2
 *
 * Newer CLI utility functions that replace and extend `utils.ts`. Uses the
 * updated `CompileHelper.fromFileSystem` API with an options object and the
 * `CompilerOpts` type. Also provides `getTypesFromCommandLineInputs` for
 * reading type nodes from `.sol` or `.json` files.
 *
 * Commands that have been migrated to the new compiler API import from this
 * file; legacy commands still use `utils.ts`.
 */

import { existsSync, readFileSync } from "fs";
import path from "path";
import {
  ASTSearch,
  CompilationOutput,
  LatestCompilerVersion
} from "solc-typed-ast";
import {
  getAllFilesInDirectory,
  getCommonBasePath,
  getRelativePath,
  isDirectory,
  StructuredText,
  writeNestedStructure
} from "../utils";
import { CompileHelper } from "../utils/compile_utils/compile_helper";
import {
  CompilerOptions,
  getCompilerOptionsWithDefaults,
  UserCompilerOptions,
  CompilerOutputConfigs,
  CompilerOpts
} from "../utils/compile_utils/solc";
import {
  TypeNodeReaderResult,
  readTypeNodesFromABI,
  readTypeNodesFromContractInterface
} from "../readers";
import _ from "lodash";

/** Resolved CLI input/output paths along with the compiled `CompileHelper` instance. */
export type CommandLineInputPaths = {
  basePath: string;
  fileName: string;
  input: string;
  output: string;
  helper: CompileHelper;
};

/**
 * Reads type nodes from a `.sol` or `.json` input file. For `.json` files,
 * parses the ABI via `readTypeNodesFromABI`. For `.sol` files, compiles the
 * source and extracts types via `readTypeNodesFromContractInterface`.
 *
 * @param input - Absolute path to a `.sol` or `.json` file.
 * @param output - Optional output directory; defaults to the input's parent directory.
 * @param contract - Optional contract name filter (currently unused in implementation).
 * @returns Parsed types keyed by contract name, along with resolved paths.
 */
export async function getTypesFromCommandLineInputs({
  input,
  output,
  contract
}: {
  input: string;
  output?: string;
  contract?: string;
}): Promise<{
  basePath: string;
  fileName: string;
  input: string;
  output: string;
  types: Record<string, TypeNodeReaderResult>;
}> {
  const ext = path.extname(input);
  if (!path.isAbsolute(input) || ![".sol", ".json"].includes(ext) || !existsSync(input)) {
    throw Error(`${input} is not a Solidity or JSON file or was not found.`);
  }
  const fileName = path.parse(input).base;
  const basePath = path.dirname(input);
  const abiByContract: Record<string, any> = {};
  const types: Record<string, TypeNodeReaderResult> = {};

  if (ext === ".json") {
    const data = JSON.parse(readFileSync(input).toString());
    if (Array.isArray(data)) {
      abiByContract[fileName] = data;
    } else if (data.abi) {
      abiByContract[fileName] = data.abi;
    } else {
      throw Error(`ABI not found in JSON file ${input}`);
    }
    for (const [name, abi] of Object.entries(abiByContract)) {
      types[name] = readTypeNodesFromABI(abi);
    }
  } else {
    const helper = await CompileHelper.fromFileSystem(fileName, path.dirname(input), {
      outputs: [CompilationOutput.ABI, CompilationOutput.AST]
    });

    const contracts = helper.getContractsForFile(fileName);
    for (const { name, abi } of contracts) {
      console.log(JSON.stringify(abi, null, 2));
      abiByContract[name] = abi;
      const sourceUnit = helper.getSourceUnit(fileName);
      const contract = sourceUnit.vContracts.find((c) => c.name === name);
      if (contract) {
        const search = ASTSearch.fromContract(contract, true);
        types[name] = readTypeNodesFromContractInterface(search);
      }
    }
  }
  if (!output) {
    output = basePath;
  }
  return {
    basePath,
    fileName,
    input,
    output,
    types
  };
}

/**
 * Resolves CLI input/output paths, compiles the Solidity file(s), and returns
 * a `CommandLineInputPaths` object. Uses the updated `CompileHelper.fromFileSystem`
 * API with an options object containing `settings` and `outputs`.
 *
 * @param input - Absolute path to a `.sol` file (or directory if `allowDirectory` is true).
 * @param output - Optional output directory; defaults to `basePath`.
 * @param allowDirectory - When true, accepts a directory and compiles all `.sol` files within.
 * @param optionOverrides - Optional compiler option overrides (merged with defaults).
 * @param outputConfig - Optional key into `CompilerOutputConfigs` to select compiler outputs.
 */
export async function getCommandLineInputPaths(
  { input, output }: { input: string; output?: string },
  allowDirectory?: boolean,
  optionOverrides?: UserCompilerOptions,
  outputConfig?: keyof typeof CompilerOutputConfigs
): Promise<CommandLineInputPaths> {
  if (
    !path.isAbsolute(input) ||
    (!allowDirectory && path.extname(input) !== ".sol") ||
    !existsSync(input)
  ) {
    throw Error(`${input} is not a Solidity file or was not found.`);
  }

  let fileName: string | string[];
  let basePath: string;
  if (allowDirectory && isDirectory(input)) {
    fileName = getAllFilesInDirectory(input, ".sol");
    basePath = input;
  } else {
    fileName = path.parse(input).base;
    basePath = path.dirname(input);
  }
  // If default output config or extra output selection is provided, merge them
  // otherwise use undefined to go with default output selection
  const outputs =
    outputConfig || optionOverrides?.extraOutputSelection
      ? [
          ...(outputConfig ? CompilerOutputConfigs[outputConfig] : []),
          ...(optionOverrides?.extraOutputSelection ?? [])
        ]
      : undefined;
  const helper = await CompileHelper.fromFileSystem(fileName, basePath, {
    settings: getCompilerOptionsWithDefaults(optionOverrides),
    version: LatestCompilerVersion,
    outputs
  });

  basePath = helper.basePath as string;
  fileName = getRelativePath(basePath, input);
  if (!output) {
    output = basePath;
  }
  return {
    basePath,
    fileName,
    input,
    output,
    helper
  };
}

/**
 * Renames a file entry within a `Map<string, string>` file set by updating
 * the key from `oldFileName` to `newFileName`. Throws if any other file in
 * the map imports the old file (circular import detection).
 */
export function renameFile(
  oldFileName: string,
  newFileName: string,
  files: Map<string, string>
): void {
  const filePaths = [...files.keys()];
  const basePath = getCommonBasePath(filePaths);
  if (!basePath) {
    throw Error(`No common base path in files ${filePaths.join(", ")}`);
  }
  const oldFilePath = path.join(basePath, oldFileName);
  const newFilePath = path.join(basePath, newFileName);
  const oldFile = files.get(oldFilePath);
  files.delete(oldFilePath);
  files.set(newFilePath, oldFile as string);
  for (const filePath of filePaths) {
    if (filePath !== oldFilePath) {
      const oldRelativePath = getRelativePath(filePath, oldFilePath);
      const file = files.get(filePath) as string;
      if (file.includes(oldRelativePath)) {
        throw Error(
          writeNestedStructure([
            `Rename file with circular imports not supported`,
            `Renaming ${oldFileName} to ${newFileName}`,
            `${filePath} imports ${oldRelativePath}`
          ])
        );
      }
      // files.set(filePath, file.replaceAll(oldRelativePath, newRelativePath));
    }
  }
}

/** Formats compiler settings (version, viaIR, optimizer) as `StructuredText` for display. Uses the newer `CompilerOpts` type. */
export function writeCompilerOptions(compilerOptions?: CompilerOpts): StructuredText {
  const settings = compilerOptions?.settings;
  return [
    `Settings:`,
    [
      `Version: ${LatestCompilerVersion}`,
      `viaIR: ${settings?.viaIR ?? false}`,
      `Optimizer ${settings?.optimizer?.enabled ? "On" : "Off"}`,
      ...(settings?.optimizer?.enabled ? [`Optimizer Runs: ${settings?.optimizer?.runs}`] : [])
    ]
  ];
}

/**
 * Prints the runtime code size of a compiled contract and compares it to
 * the EIP-170 contract size limit (24,577 bytes).
 */
export function printCodeSize(helper: CompileHelper, fileName: string): void {
  const contract = helper.getContractForFile(fileName);
  const contractCode = contract.runtimeCode;
  if (!contractCode) {
    throw Error(`Compiled contract has no code - it is likely an interface or abstract contract`);
  }
  const codeBuffer = Buffer.from(contractCode, "hex");
  const codeSize = codeBuffer.byteLength;
  const output: StructuredText[] = [`Runtime code size: ${codeSize} bytes`];
  const maxSize = 24577;
  const diff = maxSize - codeSize;
  if (diff > 0) {
    output.push(`${diff} bytes below contract size limit`);
  } else if (diff === 0) {
    output.push(`Exactly at contract size limit`);
  } else {
    output.push(`${-diff} bytes over contract size limit`);
  }
  console.log(
    writeNestedStructure([
      `Contract: ${contract.name}`,
      [...output, ...writeCompilerOptions(helper.compilerOptions)]
    ])
  );
}
