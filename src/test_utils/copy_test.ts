import {
  CompilationOutput,
  DataLocation,
  isInstanceOf,
  LatestCompilerVersion
} from "solc-typed-ast";
import { EnumType, StructType, TupleType } from "../ast";
import { CallResult } from "./deployment";
import { addSeparators, coerceArray, writeNestedStructure } from "../utils";
import { upgradeSourceCoders } from "../codegen/coders/generate";
import { getUniqueTypeNodes } from "../codegen/utils";
import { CompileHelper } from "../utils/compile_utils/compile_helper";
import { getAllContractDeployments, testDeployments } from "./compare_contracts";
import { getCompilerOptionsWithDefaults, UserCompilerOptions } from "../utils/compile_utils/solc";

export async function testCopiers(helper: CompileHelper, types: CopyTestType[]): Promise<void> {
  const names = copierNames.map((n) => n.replace(`.sol`, ""));
  const deployments = await getAllContractDeployments(helper, names, true);
  await testDeployments(deployments, true);
}

function extractTypeDependencies(types: CopyTestType | CopyTestType[]): string {
  types = coerceArray(types);
  const dependencies = new Map<string, string>();
  types.forEach((type) =>
    type.walk((node) => {
      if (isInstanceOf(node, EnumType, StructType) && !dependencies.has(node.identifier)) {
        dependencies.set(node.identifier, node.writeDefinition());
      }
    })
  );

  return writeNestedStructure(addSeparators([...dependencies.values()], "\n"));
}

type CopyTestType = StructType | TupleType;

function getNames(type: CopyTestType, location: DataLocation) {
  const name = location === DataLocation.CallData ? "input" : "output";
  if (type instanceof StructType) return [name];
  return type.vMembers.map((m, i) => `${name}${i}`);
}

function getParams(type: CopyTestType, location: DataLocation, withoutName?: boolean) {
  const names = getNames(type, location);
  if (type instanceof StructType) {
    return `(${type.writeParameter(location, withoutName ? "" : names[0])})`;
  }
  return `(${type.vMembers.map((m, i) => m.writeParameter(location, names[i])).join(", ")})`;
}

function createCalldataCopyFunction(type: CopyTestType) {
  const fnName = `copy_${type.identifier}`;
  const input = getParams(type, DataLocation.CallData);
  const output = getParams(type, DataLocation.Memory, true);
  const inputNames = getNames(type, DataLocation.CallData);
  // const outputNames = getNames(type, DataLocation.Memory, );
  // const assignments = inputNames.map((input, i) => `{ ${outputNames[i]} = ${input}; }`);
  return writeNestedStructure([
    `function ${fnName} ${input} external view returns ${output} {`,
    // assignments,
    [`return (${inputNames.join(",")});`],
    `}`
  ]);
}

const copierNames = ["BaseCopier.sol", "CopierWithDecoders.sol", "CopierWithSwitch.sol"];

type CopyTestResult = {
  result: CallResult;
  gas: number;
  match: boolean;
};

type CopyTestResults = {
  type: CopyTestType;
  results: CopyTestResult[];
};

/**
 * Generates copier contracts with a copy function for each struct that returns the decoded
 * input. Creates a base version, a version with decoders but no function switch and
 * a version with decoders and a function switch.
 * Tests every function and logs the gas cost.
 */
export async function createCalldataCopiers(
  types: CopyTestType[],
  compilerOptions?: UserCompilerOptions
): Promise<CompileHelper> {
  types = getUniqueTypeNodes(types);
  const structsFile = extractTypeDependencies(types);
  const files = new Map<string, string>([["Structs.sol", structsFile]]);
  console.log(`Generating copy test files...`);
  const copyFunctions = addSeparators(types.map(createCalldataCopyFunction), "\n");
  const copierFile = writeNestedStructure([
    `import "./Structs.sol";`,
    "",
    `contract BaseCopier {`,
    copyFunctions,
    `}`
  ]);
  files.set(`BaseCopier.sol`, copierFile);
  files.set(
    `CopierWithDecoders.sol`,
    copierFile.replace(`contract BaseCopier`, `contract CopierWithDecoders`)
  );
  files.set(
    `CopierWithSwitch.sol`,
    copierFile.replace(`contract BaseCopier`, `contract CopierWithSwitch`)
  );
  console.log(`Compiling copy test files...`);
  const helper = await CompileHelper.fromFiles(files);
  upgradeSourceCoders(helper, `CopierWithDecoders.sol`, {
    functionSwitch: false,
    replaceReturnStatements: true,
    decoderFileName: "Decoders1.sol"
  });
  upgradeSourceCoders(helper, `CopierWithSwitch.sol`, {
    functionSwitch: true,
    decoderFileName: "Decoders2.sol"
  });
  helper.recompile({
    outputs: [
      CompilationOutput.ABI,
      CompilationOutput.AST,
      "evm.deployedBytecode.object" as any,
      CompilationOutput.EVM_BYTECODE_OBJECT
    ],
    settings: getCompilerOptionsWithDefaults({
      optimizer: true,
      runs: "max",
      metadata: false,
      viaIR: true
    })
  });
  return helper;
}
