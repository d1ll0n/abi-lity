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

export type CommandLineInputPaths = {
  basePath: string;
  fileName: string;
  input: string;
  output: string;
  helper: CompileHelper;
};

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
  // let fileName = path.parse(input).base;
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
