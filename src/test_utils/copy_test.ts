import chalk from "chalk";
import { DataLocation, isInstanceOf, LatestCompilerVersion } from "solc-typed-ast";
import { EnumType, FunctionType, StructType, TupleType } from "../ast";
import { CallResult, TestDeployment, getTestDeployment } from "./deployment";
import {
  getDefaultForType,
  addSeparators,
  coerceArray,
  CompileHelper,
  writeNestedStructure
} from "../utils";
import { upgradeSourceCoders } from "../codegen";
import { getUniqueTypeNodes } from "../codegen/utils";

const err = chalk.bold.red;
const warn = chalk.hex("#FFA500");
const info = chalk.blue;
const success = chalk.green;

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

function getParams(type: CopyTestType, location: DataLocation) {
  const names = getNames(type, location);
  if (type instanceof StructType) {
    return `(${type.writeParameter(location, names[0])})`;
  }
  return `(${type.vMembers.map((m, i) => m.writeParameter(location, names[i])).join(", ")})`;
}

function createCalldataCopyFunction(type: CopyTestType) {
  const fnName = `copy_${type.identifier}`;
  const input = getParams(type, DataLocation.CallData);
  const output = getParams(type, DataLocation.Memory);
  const inputNames = getNames(type, DataLocation.CallData);
  const outputNames = getNames(type, DataLocation.Memory);
  const assignments = inputNames.map((input, i) => `${outputNames[i]} = ${input};`);
  return writeNestedStructure([
    `function ${fnName} ${input} external view returns ${output} {`,
    assignments,
    `}`
  ]);
}

const diffPctString = (newValue: number, oldValue: number) => {
  const diff = newValue - oldValue;
  if (diff === 0) return info(newValue);
  const pct = +((100 * diff) / oldValue).toFixed(2);
  const prefix = pct > 0 ? "+" : "";
  const color = diff > 0 ? warn : success;
  return `${newValue} (${color(`${prefix}${pct}%`)})`;
};

// eslint-disable-next-line no-control-regex
const stripANSI = (str: string) => str.replace(/\u001b\[.*?m/g, "");

function getColumnSizesAndAlignments(rows: string[][], padding = 0): Array<[number, boolean]> {
  const sizesAndAlignments: Array<[number, boolean]> = [];
  const numColumns = rows[0].length;
  for (let i = 0; i < numColumns; i++) {
    const entries = rows.map((row) => stripANSI(row[i]));
    const maxSize = Math.max(...entries.map((e) => e.length));
    const alignLeft = entries.slice(1).some((e) => !!e.match(/[a-zA-Z]/g));
    sizesAndAlignments.push([maxSize + padding, alignLeft]);
  }
  return sizesAndAlignments;
}

const padColumn = (col: string, size: number, padWith: string, alignLeft: boolean) => {
  const padSize = Math.max(0, size - stripANSI(col).length);
  const padding = padWith.repeat(padSize);
  if (alignLeft) return `${col}${padding}`;
  return `${padding}${col}`;
};

export const toCommentTable = (rows: string[][]): string[] => {
  const sizesAndAlignments = getColumnSizesAndAlignments(rows);
  rows.forEach((row) => {
    row.forEach((col, c) => {
      const [size, alignLeft] = sizesAndAlignments[c];
      row[c] = padColumn(col, size, " ", alignLeft);
    });
  });

  const completeRows = rows.map((row) => `| ${row.join(" | ")} |`);
  const rowSeparator = `==${sizesAndAlignments.map(([size]) => "=".repeat(size)).join("===")}==`;
  completeRows.splice(1, 0, rowSeparator);
  completeRows.unshift(rowSeparator);
  completeRows.push(rowSeparator);
  return completeRows;
};

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

async function testStruct(
  deployments: TestDeployment[],
  type: CopyTestType
): Promise<CopyTestResults> {
  const results: CopyTestResult[] = [];
  const fnName = `copy_${type.identifier}`;
  const inputData = getDefaultForType(type, 1);
  for (let i = 0; i < 3; i++) {
    const deployment = deployments[i];
    const result = await deployment.call(
      fnName,
      ...(type instanceof StructType ? [inputData] : (inputData as any[]))
    );
    const match = result.rawData === result.rawReturnData;
    const gas = Number(result.executionGasUsed);
    results.push({ result, match, gas });
  }
  return { results, type };
}

const getTypeLabel = (type: CopyTestType) => {
  if (type instanceof StructType) return type.name;
  return `(${type.vMembers.map((m) => m.canonicalName).join(", ")})`;
};

export async function testCopiers(helper: CompileHelper, types: CopyTestType[]): Promise<void> {
  types = getUniqueTypeNodes(types);
  const contracts = copierNames.map((name) => helper.getContractForFile(name));
  const abi = contracts[0].abi;

  const copiers: TestDeployment[] = await Promise.all(
    contracts.map(async (contract) => getTestDeployment(contract.runtimeCode, abi))
  );
  const outputRows: string[][] = [[``, `base`, `w/ decoders`, `w/ switch`]];
  const sums = [0, 0, 0];
  for (const type of types) {
    const label = getTypeLabel(type);
    const row: string[] = [`copy ${label} (gas)`];
    const { results } = await testStruct(copiers, type);
    const baseGasCost = results[0].gas;
    results.forEach(({ gas, match }, i): any => {
      sums[i] += gas;
      const gasString = diffPctString(gas, baseGasCost);
      row.push(match ? gasString : err(`fail`));
    });
    outputRows.push(row);
  }
  const avgs = sums.map((sum) => Math.floor(sum / types.length));
  const baseAverage = avgs[0];
  const averagesRow = avgs.map((avg) => diffPctString(avg, baseAverage));
  outputRows.push([`average copy gas`, ...averagesRow]);
  const baseSize = copiers[0].contractCodeSize;
  const decoderSize = copiers[1].contractCodeSize;
  const switchSize = copiers[2].contractCodeSize;
  const sizeRow = [
    `contract size`,
    info(baseSize),
    `${decoderSize} (${diffPctString(decoderSize, baseSize)})`,
    `${switchSize} (${diffPctString(switchSize, baseSize)})`
  ];
  outputRows.push(sizeRow);
  const output = toCommentTable(outputRows);
  output.splice(output.length - 2, 0, output[0]);
  output.splice(output.length - 4, 0, output[0]);
  console.log(output.join("\n"));
}

/**
 * Generates copier contracts with a copy function for each struct that returns the decoded
 * input. Creates a base version, a version with decoders but no function switch and
 * a version with decoders and a function switch.
 * Tests every function and logs the gas cost.
 */
export async function createCalldataCopiers(types: CopyTestType[]): Promise<CompileHelper> {
  types = getUniqueTypeNodes(types);
  const structsFile = extractTypeDependencies(types);
  const files = new Map<string, string>([["Structs.sol", structsFile]]);
  console.log(`Generating copy test files...`);
  const copyFunctions = addSeparators(types.map(createCalldataCopyFunction), "\n");
  const copierFile = writeNestedStructure([
    `import "./Structs.sol";`,
    "",
    `contract Copier {`,
    copyFunctions,
    `}`
  ]);
  files.set(`BaseCopier.sol`, copierFile);
  files.set(
    `CopierWithDecoders.sol`,
    copierFile.replace(`contract Copier`, `contract CopierWithDecoders`)
  );
  files.set(
    `CopierWithSwitch.sol`,
    copierFile.replace(`contract Copier`, `contract CopierWithSwitch`)
  );
  const helper = await CompileHelper.fromFiles(LatestCompilerVersion, files, undefined, true);
  upgradeSourceCoders(helper, `CopierWithDecoders.sol`, {
    functionSwitch: false,
    decoderFileName: "Decoders.sol"
  });
  upgradeSourceCoders(helper, `CopierWithSwitch.sol`, {
    functionSwitch: true,
    decoderFileName: "Decoders.sol"
  });
  helper.recompile(true);
  return helper;
}
