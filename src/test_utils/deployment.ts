import { addHexPrefix, Address, bufferToHex, toBuffer } from "@ethereumjs/util";
import { Chain, Common, Hardfork } from "@ethereumjs/common";
import { Interface, JsonFragment } from "@ethersproject/abi";
import { VM } from "@ethereumjs/vm";
import { getDefaultForType } from "../utils";
import { readTypeNodesFromABI, TypeNodeReaderResult } from "../readers";

let nextAddressIndex = 0xff;
const getNextAddress = () =>
  Address.fromString(addHexPrefix((++nextAddressIndex).toString(16).padStart(40, "0")));

export type CallResult = {
  rawData: string;
  rawReturnData: string;
  data: any[];
  returnData: any;
  executionGasUsed: bigint;
};

export type TestDeployment = {
  vm: VM;
  call: (fnName: string, ...args: any[]) => Promise<CallResult>;
  encodeCall: (fnName: string, ...args: any[]) => Buffer;
  callDefault: (fnName: string, i?: number) => Promise<CallResult>;
  interface: Interface;
  address: Address;
  contractCodeSize: number;
  irOptimized?: string;
  types: TypeNodeReaderResult;
};

export async function getTestDeployment(
  runtimeCode: string,
  abi: JsonFragment[]
): Promise<TestDeployment> {
  const iface = new Interface(abi);
  const types = readTypeNodesFromABI(abi);
  const address = getNextAddress();
  const common = new Common({
    chain: Chain.Mainnet,
    hardfork: Hardfork.Berlin
  });
  const vm = await VM.create({ common });
  const contractCodeBuffer = Buffer.from(runtimeCode, "hex");
  await vm.stateManager.putContractCode(address, contractCodeBuffer);

  const encodeCall = (fnName: string, ...args: any[]) =>
    toBuffer(iface.encodeFunctionData(fnName, args));

  const call = async (fnName: string, ...args: any[]) => {
    const data = encodeCall(fnName, ...args);
    const {
      execResult: { returnValue: rawReturnData, executionGasUsed }
    } = await vm.evm.runCall({
      to: address,
      data
    });
    let returnData: any;
    try {
      returnData = iface.decodeFunctionResult(fnName, rawReturnData);
    } catch (err) {
      console.error(`error decoding fn result! ${err}`);
    }
    return {
      rawData: bufferToHex(data.subarray(4)),
      rawReturnData: bufferToHex(rawReturnData),
      data: args,
      returnData,
      executionGasUsed
    };
  };

  const callDefault = async (fnName: string, i = 1) => {
    const fn = types.functions.find((fn) => fn.name === fnName);
    if (!fn) {
      throw Error(`Function ${fnName} not found`);
    }
    const defaults = getDefaultForType(fn, i) as any[];
    return call(fnName, ...defaults);
  };

  return {
    vm,
    call,
    encodeCall,
    callDefault,
    interface: iface,
    address,
    contractCodeSize: contractCodeBuffer.byteLength,
    types
  };
}
