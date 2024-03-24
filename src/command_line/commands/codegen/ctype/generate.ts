import {
  ASTSearch,
  ContractDefinition,
  ContractKind,
  DataLocation,
  FunctionDefinition,
  FunctionStateMutability,
  FunctionVisibility,
  assert
} from "solc-typed-ast";
import { WrappedScope, WrappedSourceUnit } from "../../../../codegen/ctx/contract_wrapper";
import { FunctionType } from "../../../../ast";
import { StructuredText, toHex, wrap, writeNestedStructure } from "../../../../utils";
import { CompileHelper } from "../../../../utils/compile_utils/compile_helper";
import { functionDefinitionToTypeNode } from "../../../../readers";
import { yulAdd } from "../../../../codegen/coders/storage_cache/accessors";
import { err } from "../../../../test_utils/logs";

export type ContractTypeOptions = {
  zeroUsedMemory?: boolean;
  skipBaseContracts?: boolean;
};

export function generateContractType(
  helper: CompileHelper,
  fileName: string,
  contractName?: string,
  options: ContractTypeOptions = {}
): void {
  const sourceUnit = helper.getSourceUnit(fileName);
  const contract = contractName
    ? sourceUnit.getChildrenByType(ContractDefinition).find((c) => c.name === contractName)
    : sourceUnit.getChildrenByType(ContractDefinition)[0];
  assert(
    contract !== undefined,
    contractName
      ? `Contract ${contractName} not found in ${fileName}`
      : `No contract found in ${fileName}`
  );
  const ctx = WrappedSourceUnit.getWrapper(helper, `Lib${contract.name}.sol`);
  generateContractTypeLibrary(ctx, contract, !options.skipBaseContracts, options.zeroUsedMemory);
  ctx.applyPendingFunctions();
}

function generateContractTypeLibrary(
  libSourceUnit: WrappedSourceUnit,
  contract: ContractDefinition,
  includeBaseContracts: boolean,
  zeroUsedMemory?: boolean
) {
  const externalFunctions = (
    includeBaseContracts
      ? ASTSearch.fromContract(contract, true).find("FunctionDefinition")
      : contract.getChildrenByType(FunctionDefinition)
  ).filter((fn) =>
    [FunctionVisibility.External, FunctionVisibility.Public].includes(fn.visibility)
  );

  const lib = libSourceUnit.addContract(`Lib${contract.name}`, ContractKind.Library);
  libSourceUnit.addValueTypeDefinition(
    `${contract.name}`,
    false,
    libSourceUnit.factory.makeElementaryTypeName(`address`, `address`, "nonpayable")
  );
  lib.addCustomTypeUsingForDirective(
    contract.name,
    libSourceUnit.factory.makeIdentifierPath(`Lib${contract.name}`, lib.scope.id),
    undefined,
    true
  );
  for (const fn of externalFunctions) {
    createExternalFunctionCaller(
      lib,
      functionDefinitionToTypeNode(fn),
      fn.stateMutability,
      zeroUsedMemory,
      contract.name
    );
  }
  return lib;
}

export function createExternalFunctionCaller(
  ctx: WrappedScope,
  type: FunctionType,
  visibility: FunctionStateMutability,
  zeroUsedMemory?: boolean,
  targetType = "address"
): void {
  const params = type.parameters;
  const returnParams = type.returnParameters;

  const paramDefinitions =
    params?.vMembers.map((param, i) =>
      param.writeParameter(DataLocation.Memory, param?.labelFromParent ?? `param${i}`)
    ) ?? [];

  const ethValue =
    visibility === FunctionStateMutability.Payable
      ? paramDefinitions?.unshift("uint256 ethValue") && "ethValue"
      : 0;
  paramDefinitions.unshift(`${targetType} target`);
  const returnParameterDefinitions = returnParams?.vMembers.map((param, i) =>
    param.writeParameter(DataLocation.Memory, param?.labelFromParent ?? `out${i}`)
  );
  if (
    !(params?.hasEmbeddedReferenceTypes ?? false) &&
    !(returnParams?.hasEmbeddedReferenceTypes ?? false)
  ) {
    const selector = type.functionSelector;

    const asmBody: StructuredText[] = [];
    const inputSize = 4 + (params?.vMembers.length ?? 0) * 32;
    const outputSize = (returnParams?.vMembers.length ?? 0) * 32;

    let freeMemoryPointer: string | undefined;
    let restoreFreePointer = false;
    let restoreZeroSlot = false;
    let writingToFreePointer = false;
    const getPtr = (name: string, size: number) => {
      // If size is above 128 bytes, we need to use the free memory pointer
      if (size > 0x80) {
        writingToFreePointer = true;
        if (freeMemoryPointer) return freeMemoryPointer;
        freeMemoryPointer = name;
        asmBody.push(`let ${name} := mload(0x40)`);
        return name;
      }
      // If size is above 64 bytes, we need to restore the free memory pointer
      if (size > 0x40) {
        freeMemoryPointer = "freePtr";
        restoreFreePointer = true;
        asmBody.push(
          `/// Cache the free memory pointer`,
          `let ${freeMemoryPointer} := mload(0x40)`
        );
      }
      // If size is above 96 bytes, we need to restore the zero slot
      if (size > 0x60) {
        restoreZeroSlot = true;
      }
      return 0;
    };

    const inPtr = getPtr("ptr", inputSize + 28);
    const outPtr = getPtr("outPtr", outputSize);
    asmBody.push(`mstore(${inPtr}, ${selector})`);
    //inputSize <= 0x64 ? (inputSize > 0x24 ? asmBody.push() 0 : asmBody.push("let ptr := mload(0x40)") && "ptr";
    // const outPtr = outputSize <= 0x64 ? 0 : asmBody.push("let outPtr := mload(0x40)") && "outPtr";
    params?.vMembers.forEach((param, i) => {
      const label = param.labelFromParent ?? `param${i}`;
      asmBody.push(`mstore(${yulAdd(inPtr, 32 + i * 32)}, ${label})`);
    });
    const exactInputPtr = yulAdd(inPtr, 28);
    const isStaticCall = [
      FunctionStateMutability.View,
      FunctionStateMutability.Pure,
      FunctionStateMutability.Constant
    ].includes(visibility);
    const callExpr = isStaticCall
      ? `staticcall(gas(), target, ${exactInputPtr}, ${inputSize}, ${outPtr}, ${outputSize})`
      : `call(gas(), target, ${ethValue}, ${exactInputPtr}, ${inputSize}, ${outPtr}, ${outputSize})`;
    let successExpr: StructuredText;
    if (outputSize > 0) {
      successExpr = [`and(`, [`gt(returndatasize(), ${toHex(outputSize - 1)}),`, callExpr], `)`];
    } else {
      successExpr = [callExpr];
    }
    asmBody.push(
      `if iszero(${writeNestedStructure(successExpr)}) {`,
      [`returndatacopy(0, 0, returndatasize())`, `revert(0, returndatasize())`],
      `}`
    );

    returnParams?.vMembers.forEach((param, i) => {
      const label = param.labelFromParent ?? `out${i}`;
      asmBody.push(`${label} := mload(${yulAdd(outPtr, i * 32)})`);
    });

    if (restoreFreePointer)
      asmBody.push(`/// Restore the free memory pointer`, `mstore(0x40, ${freeMemoryPointer})`);
    if (restoreZeroSlot) asmBody.push(`/// Restore the zero slot`, `mstore(0x60, 0)`);

    const maxMem = Math.max(inputSize, outputSize);
    if (zeroUsedMemory && writingToFreePointer) {
      asmBody.push(`calldatacopy(${freeMemoryPointer}, calldatasize(), ${toHex(maxMem + 28)})`);
    }

    ctx.addInternalFunction(
      type.name,
      paramDefinitions.join(", "),
      returnParameterDefinitions?.join(", "),
      wrap(asmBody, "assembly {", "}", true),
      isStaticCall ? FunctionStateMutability.View : FunctionStateMutability.NonPayable
    );
  } else {
    console.log(
      err(
        writeNestedStructure([
          `Temporarily Not Supported: function \`${type.name}\` has reference type parameters:`,
          [
            ...(params
              ?.getChildrenBySelector((c) => c.isReferenceType, false)
              .map((c) => c.writeParameter(DataLocation.CallData, "")) ?? []),
            ...(returnParams
              ?.getChildrenBySelector((c) => c.isReferenceType, false)
              .map((c) => c.writeParameter(DataLocation.Memory, "")) ?? [])
          ]
        ])
      )
    );
  }
}
