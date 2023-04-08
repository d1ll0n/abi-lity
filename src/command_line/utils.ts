#!/usr/bin/env node
import { JsonFragment } from "@ethersproject/abi";
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  ContractDefinition,
  FunctionDefinition,
  FunctionVisibility,
  getFilesAndRemappings,
  LatestCompilerVersion
} from "solc-typed-ast";
import yargs, { Options } from "yargs";
import { FunctionType, StructType, TupleType } from "../ast";
import { isExternalFunction } from "../codegen";
import { addExternalWrappers, generateSerializers, upgradeSourceCoders } from "../codegen/generate";
import { cleanIR } from "../codegen/utils";
import {
  functionDefinitionToTypeNode,
  readTypeNodesFromABI,
  readTypeNodesFromSolcAST,
  readTypeNodesFromSolidity
} from "../readers";
import { createCalldataCopiers, testCopiers } from "../test_utils";
import { getAllContractDeployments, testDeployments } from "../test_utils/compare_contracts";
import { toCommentTable } from "../test_utils/logs";
import {
  coerceArray,
  CompileHelper,
  DebugLogger,
  getAllFilesInDirectory,
  getCommonBasePath,
  getRelativePath,
  isDirectory,
  mkdirIfNotExists,
  optimizedCompilerOptions,
  StructuredText,
  UserCompilerOptions,
  writeFilesTo,
  writeNestedStructure
} from "../utils";

/*       if (path.extname(input).toLowerCase() === ".json") {
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
        const { files, fileName } = resolveFiles(input, false);
        console.log({ fileName, input });
        const filePaths = [...files.keys()];
        filePaths.reverse();
        const code = filePaths.map((p) => files.get(p) as string).join("\n\n");

        types = readTypeNodesFromSolidity(code).functions;
      } else {
        throw Error(`Input file must be a .sol file or a JSON artifact or ABI file`);
      } */

async function handlePathArgs(
  { input, output }: { input: string; output?: string },
  allowDirectory?: boolean,
  optimize = true,
  optionOverrides?: UserCompilerOptions
) {
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

function renameFile(oldFileName: string, newFileName: string, files: Map<string, string>) {
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

function printCodeSize(helper: CompileHelper, fileName: string) {
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
      [
        ...output,
        `Settings:`,
        [
          `Version: ${LatestCompilerVersion}`,
          `viaIR: true`,
          `Optimizer ${helper.compilerOptions?.optimizer?.enabled ? "On" : "Off"}`,
          ...(helper.compilerOptions?.optimizer?.enabled
            ? [`Optimizer Runs: ${helper.compilerOptions?.optimizer?.runs}`]
            : [])
        ]
      ]
    ])
  );
}
