import {
  ASTWriter,
  ContractKind,
  DataLocation,
  DefaultASTWriterMapping,
  FunctionStateMutability,
  LatestCompilerVersion,
  PrettyFormatter,
  SourceUnit,
  StructDefinition,
  UserDefinedValueTypeDefinition
} from "solc-typed-ast";
import { ArrayType, StructType } from "../../../ast";
import { addDefinitionImports, toHex } from "../../../utils";
import { WrappedContract, WrappedSourceUnit, wrapScope } from "../../ctx/contract_wrapper";
import { getOffsetYulExpression } from "../../offsets";
import NameGen, { pascalCaseToCamelCase } from "../../names";
import { getReadFromMemoryAccessor, getWriteToMemoryAccessor } from "./accessors";
import { yulAdd } from "./accessors/utils";
import {
  StoragePosition,
  SolidityStoragePositionsTracker
} from "../../../analysis/solidity_storage_positions";
import { readTypeNodesFromSolcAST } from "../../../readers";
import { CompileHelper } from "../../../utils/compile_utils/compile_helper";
import assert from "assert";

export class PackedMemoryTypeGenerator {
  storagePositions: StoragePosition[] = [];
  cacheTypeName: string;
  cacheLibraryName: string;
  variableName: string;
  ctx: WrappedContract;
  customType: UserDefinedValueTypeDefinition;

  constructor(
    public typeDefinition: StructDefinition | undefined,
    public type: StructType | ArrayType,
    sourceUnit: WrappedSourceUnit,
    public gasToCodePreferenceRatio = 3,
    public defaultSelectionForSameScore: "leastgas" | "leastcode" = "leastgas"
  ) {
    this.storagePositions = SolidityStoragePositionsTracker.getPositions(type);
    this.cacheTypeName = NameGen.packedMemoryType(type);
    this.cacheLibraryName = NameGen.cacheTypeLibrary(type);
    this.ctx = sourceUnit.addContract(this.cacheLibraryName, ContractKind.Library);

    this.customType = this.ctx.addValueTypeDefinition(this.cacheTypeName, false);
    this.ctx.addCustomTypeUsingForDirective(
      this.cacheTypeName,
      this.ctx.factory.makeIdentifierPath(this.cacheLibraryName, this.ctx.scope.id),
      undefined,
      true
    );
    if (this.numSlots > 32) {
      throw Error(`Not implemented: storage cache for type with more than 32 slots`);
    }

    this.variableName = pascalCaseToCamelCase(type.identifier);
  }

  static fromStruct(
    typeDefinition: StructDefinition | undefined,
    struct: StructType | ArrayType,
    sourceUnit: WrappedSourceUnit,
    gasToCodePreferenceRatio = 3,
    defaultSelectionForSameScore: "leastgas" | "leastcode" = "leastgas",
    withStack = false
  ): PackedMemoryTypeGenerator {
    const generator = new PackedMemoryTypeGenerator(
      typeDefinition,
      struct,
      sourceUnit,
      gasToCodePreferenceRatio,
      defaultSelectionForSameScore
    );
    generator.createReadFromStorageFunction();
    generator.createEqFunction();
    if (withStack && generator.memberBytes <= 32) {
      generator.createReadToStack();
    }
    for (const position of generator.storagePositions) {
      generator.createReadParameterFromMemoryFunction(position);
      generator.createWriteParameterToMemoryFunction(position);
    }
    generator.createWriteToStorageFunction();
    return generator;
  }

  get memberBytes(): number {
    return this.storagePositions.reduce((t, p) => t + p.bytesLength, 0);
  }

  get numSlots(): number {
    return Math.max(...this.storagePositions.map((p) => p.slot)) + 1;
  }

  addCacheReadGlobalFunction(): void {
    if (this.typeDefinition?.parent instanceof SourceUnit) {
      addDefinitionImports(this.typeDefinition.parent, [this.ctx.scope]);
      const scope = wrapScope(this.ctx.helper, this.typeDefinition.parent);
      scope.addCustomTypeUsingForDirective(this.typeDefinition.name);
    }
  }

  createReadFromStorageFunction(): string {
    const bytesToAllocate = Math.ceil(this.memberBytes / 32) * 32;
    const assemblyBody = [
      `_cache := mload(0x40)`,
      `// Reserve space for the packed struct in memory`,
      `mstore(0x40, add(_cache, ${toHex(bytesToAllocate)}))`,
      `// Read each storage value into memory`
    ];
    for (let i = 0; i < this.numSlots; i++) {
      const memPointer = getOffsetYulExpression(`_cache`, i * 32);
      const storageSlot = getOffsetYulExpression(`stored.slot`, i);
      assemblyBody.push(`mstore(${memPointer}, sload(${storageSlot}))`);
    }
    const body = [`assembly {`, assemblyBody, `}`];

    return this.ctx.addInternalFunction(
      "cache",
      this.type.writeParameter(DataLocation.Storage, `stored`),
      `${this.cacheTypeName} _cache`,
      body
    );
  }

  createReadParameterFromMemoryFunction(position: StoragePosition): string {
    const label = position.label.split(".").pop() as string;
    const absoluteOffsetBytes = position.parentOffsetBytes;
    const returnValue = position.type.writeParameter(DataLocation.Memory, label);
    const accessor = getReadFromMemoryAccessor({
      dataReference: `_cache`,
      leftAligned: position.type.leftAligned,
      bitsOffset: absoluteOffsetBytes * 8,
      bitsLength: position.bitsLength,
      gasToCodePreferenceRatio: this.gasToCodePreferenceRatio,
      defaultSelectionForSameScore: this.defaultSelectionForSameScore
    });

    const body = `assembly { ${label} := ${accessor} }`;
    return this.ctx.addInternalFunction(
      `get${label[0].toUpperCase()}${label.slice(1)}`,
      `${this.cacheTypeName} _cache`,
      returnValue,
      body,
      FunctionStateMutability.Pure
    );
  }

  createEqFunction(): string {
    const asmBody = [];
    if (this.memberBytes < 33) {
      asmBody.push(`isEqual := eq(mload(a), mload(b))`);
    } else {
      asmBody.push(
        `isEqual := eq(keccak256(a, ${this.memberBytes}), keccak256(b, ${this.memberBytes})`
      );
    }
    return this.ctx.addInternalFunction(
      "eq",
      `${this.cacheTypeName} a, ${this.cacheTypeName} b`,
      "bool isEqual",
      [`assembly {`, asmBody, `}`],
      FunctionStateMutability.Pure,
      [`/// Compare two ${this.cacheTypeName} instances for equality`]
    );
  }

  createReadToStack(): string {
    assert(
      this.memberBytes <= 32,
      `Can not read packed struct to stack that has more than 32 bytes`
    );
    const stackTypeName = NameGen.packedStackType(this.type);
    const outputVariableName = `stack${this.type.identifier}`;
    const body = [`assembly {`, [`${outputVariableName} := mload(${this.variableName})`], `}`];
    return this.ctx.addInternalFunction(
      `read`,
      `${this.cacheTypeName} ${this.variableName}`,
      `${stackTypeName} ${outputVariableName}`,
      body,
      FunctionStateMutability.Pure
    );
  }

  createWriteParameterToMemoryFunction(position: StoragePosition): string {
    const label = position.label.split(".").pop() as string;
    const absoluteOffsetBytes = position.parentOffsetBytes;
    const newValueParameter = position.type.writeParameter(DataLocation.Memory, label);
    const accessor = getWriteToMemoryAccessor({
      dataReference: `_cache`,
      leftAligned: position.type.leftAligned,
      bitsOffset: position.parentOffsetBits,
      bitsLength: position.bitsLength,
      value: label,
      gasToCodePreferenceRatio: this.gasToCodePreferenceRatio,
      defaultSelectionForSameScore: this.defaultSelectionForSameScore
    });
    const body = [`assembly {`, [`// Overwrite ${label} in cache`, ...accessor.split("\n")], `}`];
    return this.ctx.addInternalFunction(
      `set${label[0].toUpperCase()}${label.slice(1)}`,
      `${this.cacheTypeName} _cache, ${newValueParameter}`,
      undefined,
      body,
      FunctionStateMutability.Pure
    );
  }

  createWriteToStorageFunction(): string {
    const body = [];
    for (let i = 0; i < this.numSlots; i++) {
      const slotMemoryPointer = yulAdd(`_cache`, i * 32);
      const storagePointer = yulAdd(`stored.slot`, i);
      body.push(`sstore(${storagePointer}, mload(${slotMemoryPointer}))`);
    }
    const inputParameters = [
      this.type.writeParameter(DataLocation.Storage, `stored`),
      `${this.cacheTypeName} _cache`
    ].join(", ");

    return this.ctx.addInternalFunction(
      "update",
      inputParameters,
      undefined,
      [`assembly {`, body, `}`],
      FunctionStateMutability.NonPayable
    );
  }
}

async function test() {
  const h = await CompileHelper.fromFiles(
    new Map([
      [
        "MarketState.sol",
        `struct MarketState {
             uint32 roleTimeToLive;
             address providerAddress;
             uint24 pullProviderIndex;
             uint24 pushProviderIndex;
           }`
      ]
    ]),
    `MarketState.sol`
  );

  const sourceUnit = WrappedSourceUnit.getWrapper(h, h.getSourceUnit("MarketState.sol"));
  const typeDefinition = sourceUnit.scope.getChildrenByType(StructDefinition)[0];
  const type = readTypeNodesFromSolcAST(false, sourceUnit.scope).structs[0] as StructType;
  const generator = PackedMemoryTypeGenerator.fromStruct(typeDefinition, type, sourceUnit);

  await generator.ctx.applyPendingFunctions();
  const codeOut = new ASTWriter(
    DefaultASTWriterMapping,
    new PrettyFormatter(2),
    LatestCompilerVersion
  ).write(generator.ctx.sourceUnit);
  console.log(codeOut);
}

// test();
