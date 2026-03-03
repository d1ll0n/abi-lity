/**
 * @module command_line/utils
 *
 * Older CLI utility functions for resolving input/output paths and compiling
 * Solidity files. This file uses the legacy `CompileHelper.fromFileSystem`
 * signature with positional arguments and the `CompilerOptions` type.
 *
 * Partially superseded by `utils2.ts`, which uses the updated compiler API
 * with an options object and `CompilerOpts`. Commands that have not yet been
 * migrated still import from this file.
 */

import { existsSync } from "fs";
import path from "path";
import { LatestCompilerVersion } from "solc-typed-ast";
import {
  CompileHelper,
  CompilerOptions,
  getAllFilesInDirectory,
  getCommonBasePath,
  getRelativePath,
  isDirectory,
  StructuredText,
  UserCompilerOptions,
  writeNestedStructure
} from "../utils";

/** Resolved CLI input/output paths along with the compiled `CompileHelper` instance. */
export type CommandLineInputPaths = {
  basePath: string;
  fileName: string;
  input: string;
  output: string;
  helper: CompileHelper;
};

/**
 * Resolves CLI input/output paths, compiles the Solidity file(s), and returns
 * a `CommandLineInputPaths` object. Uses the older `CompileHelper.fromFileSystem`
 * signature with positional arguments (version, fileName, basePath, optimize, overrides).
 *
 * @param input - Absolute path to a `.sol` file (or directory if `allowDirectory` is true).
 * @param output - Optional output directory; defaults to `basePath`.
 * @param allowDirectory - When true, accepts a directory and compiles all `.sol` files within.
 * @param optimize - Whether to enable the Solidity optimizer (default: true).
 * @param optionOverrides - Optional compiler option overrides.
 */
export async function getCommandLineInputPaths(
  { input, output }: { input: string; output?: string },
  allowDirectory?: boolean,
  optimize = true,
  optionOverrides?: UserCompilerOptions
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
  const helper = await CompileHelper.fromFileSystem(
    LatestCompilerVersion,
    fileName,
    basePath,
    optimize,
    optionOverrides
  );

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

/** Formats compiler settings (version, viaIR, optimizer) as `StructuredText` for display. */
export function writeCompilerOptions(compilerOptions?: CompilerOptions): StructuredText {
  return [
    `Settings:`,
    [
      `Version: ${LatestCompilerVersion}`,
      `viaIR: ${compilerOptions?.viaIR ?? false}`,
      `Optimizer ${compilerOptions?.optimizer?.enabled ? "On" : "Off"}`,
      ...(compilerOptions?.optimizer?.enabled
        ? [`Optimizer Runs: ${compilerOptions?.optimizer?.runs}`]
        : [])
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
