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
import { FunctionType, StructType, TupleType } from "./ast";
import { isExternalFunction } from "./codegen";
import { addExternalWrappers, generateSerializers, upgradeSourceCoders } from "./codegen/generate";
import { cleanIR } from "./codegen/utils";
import {
  functionDefinitionToTypeNode,
  readTypeNodesFromABI,
  readTypeNodesFromSolcAST,
  readTypeNodesFromSolidity
} from "./readers";
import { createCalldataCopiers, testCopiers } from "./test_utils";
import { getAllContractDeployments, testDeployments } from "./test_utils/compare_contracts";
import { toCommentTable } from "./test_utils/logs";
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
} from "./utils";

function resolveFiles(input: string, allowDirectory?: boolean) {
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
    fileName = getAllFilesInDirectory(input, ".sol"); //.map((f) => path.join(input, f));
    console.log(fileName);
    basePath = input;
  } else {
    fileName = path.parse(input).base;
    basePath = path.dirname(input);
  }
  const fileNames = coerceArray(fileName);
  const includePath: string[] = [];
  if (basePath) {
    let parent = path.dirname(basePath);
    while (parent !== path.dirname(parent)) {
      includePath.push(parent);
      parent = path.dirname(parent);
    }
  }
  const { files, remapping } = getFilesAndRemappings(fileNames, {
    basePath,
    includePath
  });
  const filePaths = [...files.keys()];
  if (
    basePath &&
    filePaths.some(
      (p) => path.isAbsolute(p) && path.relative(basePath as string, p).startsWith("..")
    )
  ) {
    const commonPath = getCommonBasePath(filePaths);
    basePath = commonPath ? path.normalize(commonPath) : basePath;
  }
  return {
    fileName,
    files,
    remapping,
    filePaths,
    basePath
  };
}

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

yargs
  .command(
    "ir <input> [output]",
    writeNestedStructure([
      "Generate the IR output for a Solidity contract.",
      `By default, only writes irOptimized and strips out all sourcemap comments.`
    ]),
    {
      input: {
        alias: ["i"],
        describe: "Input Solidity file.",
        demandOption: true,
        coerce: path.resolve
      },
      output: {
        alias: ["o"],
        describe: "Output directory, defaults to directory of input.",
        demandOption: false,
        coerce: path.resolve
      },
      unoptimized: {
        alias: ["u"],
        describe: "Also generate unoptimized IR.",
        default: false,
        type: "boolean"
      },
      verbose: {
        alias: ["v"],
        describe: "Keep the constructor and sourcemap comments.",
        default: false,
        type: "boolean"
      },
      runs: {
        alias: ["r"],
        default: 200,
        describe: "Optimizer runs. Either a number of 'max'"
      }
    },
    async ({ input, output, unoptimized, verbose, runs: r }) => {
      const runs = r as number | "max";
      if (!path.isAbsolute(input) || path.extname(input) !== ".sol") {
        throw Error(`${input} is not a Solidity file or was not found.`);
      }
      const basePath = path.dirname(input);
      if (!output) {
        output = basePath;
      }
      mkdirIfNotExists(output);
      const fileName = path.parse(input).base;
      const helper = await CompileHelper.fromFileSystem(
        LatestCompilerVersion,
        fileName,
        basePath,
        true,
        { runs }
      );
      const contract = helper.getContractForFile(fileName);
      const { ir, irOptimized, name } = contract;
      if (!irOptimized) {
        throw Error(
          `Contract ${name} has no intermediate representation - it is likely an interface or abstract contract`
        );
      }
      const files = [[`${name}.optimized.yul`, irOptimized]];
      if (unoptimized) {
        files.push([`${name}.yul`, ir]);
      }
      for (const [irFileName, irOutput] of files) {
        const data = verbose ? irOutput : cleanIR(irOutput);
        const filePath = path.join(output, irFileName);
        writeFileSync(filePath, data);
      }
      printCodeSize(helper, fileName);
    }
  )
  .command(
    "$0 <input> [output]",
    writeNestedStructure([
      "Generate ABI decoding library for all input/output types of external functions in a smart contract",
      "and modify the contract to use a function switch."
    ]),
    {
      input: {
        alias: ["i"],
        describe: "Input Solidity file.",
        demandOption: true,
        coerce: path.resolve
      },
      output: {
        alias: ["o"],
        describe: "Output directory, defaults to directory of input.",
        demandOption: false,
        coerce: path.resolve
      },
      decoderOnly: {
        alias: ["d"],
        describe: "Only generate ABI decoding library without modifying the contract.",
        default: false,
        type: "boolean"
      },
      ir: {
        alias: ["y"],
        describe: "Also generate irOptimized for contract.",
        default: false,
        type: "boolean"
      },
      irUnoptimized: {
        alias: ["u"],
        describe: "Also generate unoptimized IR.",
        default: false,
        type: "boolean"
      },
      verbose: {
        alias: ["v"],
        describe: "Keep the constructor and sourcemap comments in IR output.",
        default: false,
        type: "boolean"
      }
    },
    async ({ decoderOnly, irUnoptimized: unoptimized, ir: irFlag, verbose, ...args }) => {
      const { basePath, output, fileName, helper } = await handlePathArgs(args);

      const logger = new DebugLogger();
      upgradeSourceCoders(helper, fileName, { functionSwitch: !decoderOnly }, logger);

      if (unoptimized || irFlag) {
        mkdirIfNotExists(output);
        console.log(`re-compiling for IR output...`);
        helper.recompile(true);

        const contract = helper.getContractForFile(fileName);
        const { ir, irOptimized, name } = contract;
        if (!irOptimized) {
          throw Error(
            `Contract ${name} has no intermediate representation - it is likely an interface or abstract contract`
          );
        }
        const files = [[`${name}.optimized.yul`, irOptimized]];
        if (unoptimized) {
          files.push([`${name}.yul`, ir]);
        }
        for (const [irFileName, irOutput] of files) {
          const data = verbose ? irOutput : cleanIR(irOutput);
          const filePath = path.join(output, irFileName);
          writeFileSync(filePath, data);
        }
      }
      console.log(`writing files...`);
      const files = helper.getFiles();
      if (output === basePath /* && !decoderOnly */) {
        const suffix = decoderOnly ? `WithDecoders.sol` : `WithDecodersAndSwitch.sol`;
        const newFileName = fileName.replace(".sol", suffix);
        renameFile(fileName, newFileName, files);
        // throw Error(`Output can not match basePath when decoderOnly is false.`);
      }
      writeFilesTo(output, files);
      console.log(`done!`);
    }
  )
  .command(
    "size <input>",
    writeNestedStructure([
      "Print the size in bytes of the runtime code of a contract.",
      "By default, prints the runtime code size when compiled with 20,000 optimizer runs."
    ]),
    {
      input: {
        alias: ["i"],
        describe: "Input Solidity file.",
        demandOption: true,
        coerce: path.resolve
      },
      unoptimized: {
        alias: ["u"],
        describe: "Print the unoptimized code size.",
        default: false,
        type: "boolean"
      },
      creationCode: {
        alias: ["c"],
        describe: "Print the creation code size.",
        default: false,
        type: "boolean"
      }
    },
    async ({ input, unoptimized }) => {
      if (!path.isAbsolute(input) || path.extname(input) !== ".sol") {
        throw Error(`${input} is not a Solidity file or was not found.`);
      }
      const basePath = path.dirname(input);
      const fileName = path.parse(input).base;
      const helper = await CompileHelper.fromFileSystem(
        LatestCompilerVersion,
        fileName,
        basePath,
        !unoptimized
      );
      printCodeSize(helper, fileName);
    }
  )
  .command(
    "selectors <input> [name] [output]",
    writeNestedStructure(["Generate function selectors for external functions in a contract"]),
    {
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
    },
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
        const { files, fileName } = resolveFiles(input, false);
        console.log({ fileName, input });
        const filePaths = [...files.keys()];
        filePaths.reverse();
        const code = filePaths.map((p) => files.get(p) as string).join("\n\n");

        types = readTypeNodesFromSolidity(code).functions;
      } else {
        throw Error(`Input file must be a .sol file or a JSON artifact or ABI file`);
      }
      types = types.filter(isExternalFunction);

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
  )
  .command(
    "copy-test <input> [output]",
    writeNestedStructure([
      "Generate copy contract for types in a file as well as an optimized versions",
      "with abi-lity encoders and a version with a function switch, then test all copy",
      "functions in all three contracts and compare gas and code size."
    ]),
    {
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
      }
    },
    async ({ input, output, ir }) => {
      if (!path.isAbsolute(input) || path.extname(input) !== ".sol") {
        throw Error(`${input} is not a Solidity file or was not found.`);
      }
      let basePath = path.dirname(input);

      let fileName = path.parse(input).base;
      console.log(`compiling ${fileName}...`);
      const helper = await CompileHelper.fromFileSystem(
        LatestCompilerVersion,
        fileName,
        basePath,
        true
      );
      basePath = helper.basePath as string;
      fileName = getRelativePath(basePath, input);
      const sourceUnit = helper.getSourceUnit(fileName);
      const types: Array<StructType | TupleType> = [];
      const contract = sourceUnit.getChildrenByType(ContractDefinition)[0];
      if (contract) {
        const functions = contract
          .getChildrenByType(FunctionDefinition)
          .filter(isExternalFunction)
          .map(functionDefinitionToTypeNode);
        const tuples = functions.map((fn) => fn.parameters).filter(Boolean) as TupleType[];
        types.push(...tuples);
      } else {
        const { structs } = readTypeNodesFromSolcAST(sourceUnit);
        types.push(...structs);
      }
      const copyHelpers = await createCalldataCopiers(types);
      await testCopiers(copyHelpers, types);
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
  )
  .command(
    "compare <input>",
    writeNestedStructure([
      "Compare gas and codesize of contracts with different implementations",
      "of the same functions."
    ]),
    {
      input: {
        alias: ["i"],
        describe: "Input Solidity or JSON file.",
        demandOption: true,
        coerce: path.resolve
      },
      ir: {
        alias: ["y"],
        describe: "Also generate irOptimized for contract.",
        default: false,
        type: "boolean"
      }
    },
    async (args) => {
      const { basePath, output, fileName, helper } = await handlePathArgs(args, true);
      const deployments = await getAllContractDeployments(helper);
      await testDeployments(deployments);
    }
  )
  .command(
    "wrappers <input> [output]",
    writeNestedStructure(["Generate external wrappers for free/library functions in a file."]),
    {
      input: {
        alias: ["i"],
        describe: "Input Solidity file.",
        demandOption: true,
        coerce: path.resolve
      },
      output: {
        alias: ["o"],
        describe: "Output directory, defaults to directory of input.",
        demandOption: false,
        coerce: path.resolve
      }
    },
    async (args) => {
      const { basePath, output, fileName, helper } = await handlePathArgs(args);

      const logger = new DebugLogger();
      addExternalWrappers(helper, fileName, logger);

      console.log(`writing files...`);
      const files = helper.getFiles();
      if (output === basePath /* && !decoderOnly */) {
        const suffix = `ExternalFile.sol`;
        const newFileName = fileName.replace(".sol", suffix);
        renameFile(fileName, newFileName, files);
      }
      writeFilesTo(output, files);
      console.log(`done!`);
    }
  )
  .command(
    "forge-json <input> [output]",
    writeNestedStructure(["Generate JSON serializers for forge"]),
    {
      input: {
        alias: ["i"],
        describe: "Input Solidity file.",
        demandOption: true,
        coerce: path.resolve
      },
      output: {
        alias: ["o"],
        describe: "Output directory, defaults to directory of input.",
        demandOption: true,
        coerce: path.resolve
      },
      struct: {
        alias: ["s"],
        describe: "Struct to generate serializers for",
        type: "array"
      }
    },
    async (args) => {
      const { basePath, output, fileName, helper } = await handlePathArgs(args, false, false, {
        optimizer: false,
        runs: 0,
        viaIR: false
      });
      const logger = new DebugLogger();
      mkdirIfNotExists(output);
      const primaryFilePath = path.join(
        output,
        path.basename(fileName.replace(".sol", "Serializers.sol"))
      );
      generateSerializers(
        helper,
        fileName,
        {
          outPath: output,
          functionSwitch: false,
          decoderFileName: primaryFilePath
        },
        args.struct as string | string[],
        logger
      );
      console.log(`writing serializer...`);
      const files = helper.getFiles();
      const newCode = writeNestedStructure([
        `import { Vm } from "forge-std/Vm.sol";`,
        "",
        `address constant VM_ADDRESS = address(`,
        [`uint160(uint256(keccak256("hevm cheat code")))`],
        `);`,
        `Vm constant vm = Vm(VM_ADDRESS);`
      ]);
      const code = files.get(primaryFilePath) as string;
      files.clear();
      files.set(primaryFilePath, code.replace(`import "./Temp___Vm.sol";`, newCode));
      writeFilesTo(output, files);
      console.log(`done!`);
    }
  )
  // .help("h", true)
  .fail(function (msg, err) {
    if (msg) {
      console.error(msg);
    }
    if (err?.message) {
      console.error(err.message);
    }
    // console.error(`Error: ${err?.message}`);
    throw err;
  }).argv;
