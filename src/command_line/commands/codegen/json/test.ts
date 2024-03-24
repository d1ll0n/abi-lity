import { getAddress } from "@ethersproject/address";
import {
  AddressType,
  ArrayType,
  BoolType,
  DefaultVisitor,
  EnumType,
  FixedBytesType,
  IntegerType,
  StructType,
  TypeNode,
  UABIType,
  ValueType
} from "../../../../ast";
import NameGen from "../../../../codegen/names";
import { TestDeployment, getTestDeployment } from "../../../../test_utils";
import { getDefaultForType, toHex } from "../../../../utils";
import {
  WrappedContract,
  WrappedScope,
  WrappedSourceUnit
} from "../../../../codegen/ctx/contract_wrapper";
import { CompilerOutputConfigs } from "../../../../utils/compile_utils/solc";
import { FunctionDefinition, assert } from "solc-typed-ast";
import { buildExternalWrapper } from "../../../../codegen/wrappers";

async function testTypeSerializer(deployment: TestDeployment, type: TypeNode) {
  const name = NameGen.serialize(type);
  const value = getDefaultForType(type, 1);
  const result = await deployment.call(name, value);
  const expectedResult = JSON.stringify(serializeValue(type, value));
  const actualResult = result.returnData[0];
  if (actualResult !== expectedResult) {
    console.log(
      `Expected:\n(${typeof expectedResult}) ${expectedResult}\nGot:\n(${typeof actualResult})${actualResult}`
    );
    throw Error(`Got bad result for ${type.identifier}`);
  } else {
    console.log(`Got expected result for ${type.identifier}`);
  }
}

export async function testSerializers(coderCtx: WrappedScope): Promise<void> {
  if (coderCtx instanceof WrappedContract) {
    coderCtx = WrappedSourceUnit.getWrapper(coderCtx.helper, coderCtx.sourceUnit);
  }
  const fns = coderCtx.scope.getChildrenByType(FunctionDefinition);
  console.log(`Generating wrapper for ${fns.length} fns`);
  const testCtx = WrappedSourceUnit.getWrapper(coderCtx.helper, "ExternalWrapper.sol");
  buildExternalWrapper(testCtx as WrappedSourceUnit, fns);
  coderCtx.helper.recompile({ outputs: CompilerOutputConfigs.TESTS });

  const contract = coderCtx.helper
    .getContractsForFile("ExternalWrapper.sol")
    .find((c) => c.name === "ExternalWrapper");
  assert(contract !== undefined, "Could not find ExternalWrapper contract");
  const deployment = await getTestDeployment(contract.runtimeCode, contract.abi, contract.name);
  console.log(`Testing ${deployment.types.functions.length} functions`);
  for (const fn of deployment.types.functions) {
    assert(
      fn.parameters?.vMembers.length === 1,
      "Expected one parameter in serialize function " + fn.name
    );
    const type = fn.parameters.vMembers[0];
    await testTypeSerializer(deployment, type);
  }
}

function serializeValue(type: TypeNode, value: any): any {
  if (type instanceof AddressType) return getAddress(value);
  if (type instanceof IntegerType) {
    if (
      (value as bigint) > BigInt(Number.MAX_SAFE_INTEGER) ||
      (value as bigint) < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      return toHex(value);
    }
    return +value.toString();
  }
  if (type instanceof BoolType) {
    return value as boolean;
  }
  if (type instanceof EnumType) {
    return type.members[value as number];
  }
  if (type instanceof FixedBytesType) {
    return toHex(value);
  }
  if (type instanceof ArrayType) {
    return (value as any[]).map((v) => serializeValue(type.baseType, v));
  }
  if (type instanceof StructType) {
    const obj: Record<string, any> = {};
    for (const member of type.children) {
      obj[member.labelFromParent as string] = serializeValue(
        member,
        value[member.labelFromParent as string]
      );
    }
    return obj;
  }
  throw Error(`Unimplemented: sizeof serialized type ${type.pp()}`);
}
