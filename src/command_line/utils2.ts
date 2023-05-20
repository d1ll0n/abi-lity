import { existsSync, readFileSync } from "fs";
import path from "path";
import { CompilationOutput, LatestCompilerVersion } from "solc-typed-ast";
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
import { TypeNodeReaderResult, readTypeNodesFromABI } from "../readers";

export type CommandLineInputPaths = {
  basePath: string;
  fileName: string;
  input: string;
  output: string;
  helper: CompileHelper;
};

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
  if (ext === ".json") {
    const data = JSON.parse(readFileSync(input).toString());
    if (Array.isArray(data)) {
      abiByContract[fileName] = data;
    } else if (data.abi) {
      abiByContract[fileName] = data.abi;
    } else {
      throw Error(`ABI not found in JSON file ${input}`);
    }
  } else {
    const helper = await CompileHelper.fromFileSystem(fileName, path.dirname(input), {
      outputs: [CompilationOutput.ABI, CompilationOutput.AST]
    });

    const contracts = helper.getContractsForFile(fileName);
    for (const { name, abi } of contracts) {
      console.log(JSON.stringify(abi, null, 2));
      abiByContract[name] = abi;
    }
  }
  const types: Record<string, TypeNodeReaderResult> = {};
  for (const [name, abi] of Object.entries(abiByContract)) {
    types[name] = readTypeNodesFromABI(abi);
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
  // let fileName = path.parse(input).base;
  const helper = await CompileHelper.fromFileSystem(fileName, basePath, {
    settings: getCompilerOptionsWithDefaults(optionOverrides),
    outputs: outputConfig ? CompilerOutputConfigs[outputConfig] : undefined
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
