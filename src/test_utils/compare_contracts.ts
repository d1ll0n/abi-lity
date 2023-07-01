import { toArray } from "lodash";
import { assert } from "solc-typed-ast";
import { FunctionType, TupleType } from "../ast";
import { CompileHelper } from "../utils/compile_utils/compile_helper";
import { CallResult, getTestDeployment, TestDeployment } from "./deployment";
import { err, info, diffPctString, toCommentTable } from "./logs";
import { getDefaultForType } from "../utils";
import { ContractOutput } from "../utils/compile_utils/solc";

type FunctionTestInput = {
  function: FunctionType;
  name: string;
  label: string;
  args?: any[];
};

type FunctionTestOutput = {
  result: CallResult;
  gas: number;
  match: boolean;
};

// @todo finish this to make the compare command work better
// function rankContractsByCommonFunctions(
//   helper: CompileHelper,
//   contractNames = [...helper.contractsMap.keys()]
// ) {
//   const contracts = contractNames
//     .map((name) => {
//       const contract = helper.contractsMap.get(name);
//       if (!contract?.runtimeCode || contract?.abi.length === 0) return undefined;
//       const functions = readTypeNodesFromABI(contract.abi).functions;
//       return { contract, name, functions };
//     })
//     .filter((c) => c !== undefined) as Array<{
//     contract: ContractOutput;
//     functions: FunctionType[];
//     name: string;
//   }>;

//   const ranks: Map<string, number> = new Map();
//   contracts.forEach(({ contract, name, functions }, i) => {
//     const otherContracts = [...contracts];
//     otherContracts.splice(i, 1);
//     const sharedFunctionCount = functions.map((fn) => {

//     })
//   })
// }

export function getTestsForCommonFunctions(deployments: TestDeployment[]): FunctionTestInput[] {
  const otherDeployments = deployments.slice(1);
  const functionKeys = Object.keys(deployments[0].interface.functions).filter((key) =>
    otherDeployments.every((deployment) => deployment.interface.functions[key] !== undefined)
  );
  return functionKeys.map((key, i) => {
    const name = deployments[0].interface.functions[key].name;
    const fn = deployments[0].types.functions.find((fn) => fn.name === name);
    assert(fn !== undefined, `Could not find function type for ${name}`);
    return {
      function: fn,
      name,
      label: name,
      args: getDefaultForType(fn, 1) as any[]
    };
  });
}

const getFunctionLabel = (type: FunctionType) => {
  const args = type.parameters as TupleType;
  if (args.vMembers.length === 1) return args.vMembers[0].canonicalName;
  return `(${args.vMembers.map((m) => m.canonicalName).join(", ")})`;
};

export function getTestsForCopyFunctions(deployments: TestDeployment[]): FunctionTestInput[] {
  const functionKeys = Object.keys(deployments[0].interface.functions);
  return functionKeys.map((key, i) => {
    const name = deployments[0].interface.functions[key].name;
    const fn = deployments[0].types.functions.find((fn) => fn.name === name);
    assert(fn !== undefined, `Could not find function type for ${name}`);
    return {
      function: fn,
      name,
      label: `copy ${getFunctionLabel(fn)}`,
      args: getDefaultForType(fn, 1) as any[]
    };
  });
}

export async function testFunctionForDeployments(
  deployments: TestDeployment[],
  input: FunctionTestInput
): Promise<FunctionTestOutput[]> {
  const results: FunctionTestOutput[] = [];
  const inputData = input.args ?? getDefaultForType(input.function, 1);
  for (const deployment of deployments) {
    const result = await deployment.call(input.name, ...toArray(inputData));

    const match = result.rawData === result.rawReturnData;
    if (!match) {
      console.log(
        `${deployment.name} Input Size: ${result.rawData.length} | Output Size: ${result.rawReturnData.length}`
      );
    }
    const gas = Number(result.executionGasUsed);
    results.push({ result, match, gas });
  }
  return results;
}

const CopierLabels: Record<string, string> = {
  BaseCopier: `base`,
  CopierWithDecoders: "w/ decoders",
  CopierWithSwitch: "w/ switch"
};

export async function getAllContractDeployments(
  helper: CompileHelper,
  contractNames = [...helper.contractsMap.keys()],
  copyTest?: boolean
): Promise<TestDeployment[]> {
  const contracts = contractNames
    .map((name) => {
      const contract = helper.contractsMap.get(name);
      if (!contract?.runtimeCode || (!copyTest && contract?.abi.length === 0)) return undefined;
      return { contract, name };
    })
    .filter((c) => c !== undefined) as Array<{ contract: ContractOutput; name: string }>;
  // console.log(contracts.map((c) => c.name + " " + c.contract.runtimeCode.length).join("\n"));
  return (
    await Promise.all(
      contracts.map(({ contract, name }) => {
        const label = CopierLabels[name] ?? name;
        const abi = JSON.parse(JSON.stringify(copyTest ? contracts[0].contract.abi : contract.abi));
        return getTestDeployment(contract.runtimeCode, abi, name, label);
      })
    )
  ).filter((x) => x !== undefined) as TestDeployment[];
}

export async function testDeployments(
  deployments: TestDeployment[],
  copyTest?: boolean
): Promise<void> {
  const tests = (copyTest ? getTestsForCopyFunctions : getTestsForCommonFunctions)(deployments);
  const outputRows: string[][] = [[``, ...deployments.map((d) => d.label as string)]];
  const sums = new Array(deployments.length).fill(0);
  for (const test of tests) {
    const row: string[] = [`${test.label} (gas)`];
    const results = await testFunctionForDeployments(deployments, test);
    const baseGasCost = results[0].gas;
    results.forEach(({ gas, match }, i): any => {
      sums[i] += gas;
      const gasString = diffPctString(gas, baseGasCost);
      row.push(copyTest && !match ? err(`fail`) : gasString);
    });
    if (!copyTest) {
      if (!results.every((r) => r.result.rawReturnData === results[0].result.rawReturnData)) {
        console.log(`Return data mismatch for ${test.name}`);
      }
    }
    outputRows.push(row);
  }

  const avgs = sums.map((sum) => Math.floor(sum / tests.length));
  const baseAverage = avgs[0];
  const averagesRow = avgs.map((avg) => diffPctString(avg, baseAverage));
  outputRows.push([`average ${copyTest ? "copy " : ""}gas`, ...averagesRow]);
  const sizes = deployments.map((d) => d.contractCodeSize);

  const sizeRow = [
    `contract size`,
    info(sizes[0]),
    ...sizes.slice(1).map((size) => `${size} (${diffPctString(size, sizes[0])})`)
  ];

  outputRows.push(sizeRow);
  const output = toCommentTable(outputRows);
  output.splice(output.length - 2, 0, output[0]);
  output.splice(output.length - 4, 0, output[0]);
  console.log(output.join("\n"));
}
