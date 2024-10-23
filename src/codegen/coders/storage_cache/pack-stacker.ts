import {
  ASTWriter,
  ContractKind,
  DataLocation,
  DefaultASTWriterMapping,
  FunctionStateMutability,
  LatestCompilerVersion,
  PrettyFormatter,
  StructDefinition,
  UserDefinedValueTypeDefinition
} from "solc-typed-ast";
import { ArrayType, StructType } from "../../../ast";
import { WrappedContract, WrappedSourceUnit } from "../../ctx/contract_wrapper";
import NameGen, { pascalCaseToCamelCase } from "../../names";
import {
  StoragePosition,
  SolidityStoragePositionsTracker
} from "../../../analysis/solidity_storage_positions";
import { readTypeNodesFromSolcAST } from "../../../readers";
import { CompileHelper } from "../../../utils/compile_utils/compile_helper";
import { getReadFromStackAccessor } from "./accessors/read_stack";
import { getWriteToStackAccessor } from "./accessors/write_stack";
import { packWord } from "./accessors/pack_word";
import { writeFileSync } from "fs";
import path from "path";
import { StructuredText } from "../../../utils";

export class PackedStackTypeGenerator {
  storagePositions: StoragePosition[] = [];
  cacheTypeName: string;
  cacheLibraryName: string;
  variableName: string;
  updatedVariableName: string;
  customType: UserDefinedValueTypeDefinition;
  ctx: WrappedContract;

  constructor(
    public typeDefinition: StructDefinition | undefined,
    public type: StructType | ArrayType,
    sourceUnit: WrappedSourceUnit,
    public gasToCodePreferenceRatio = 3,
    public defaultSelectionForSameScore: "leastgas" | "leastcode" = "leastgas"
  ) {
    this.storagePositions = SolidityStoragePositionsTracker.getPositions(type);
    this.cacheTypeName = NameGen.packedStackType(type);
    this.cacheLibraryName = `Lib${type.identifier}`;
    this.variableName = pascalCaseToCamelCase(type.identifier);
    this.updatedVariableName = `new${this.variableName[0].toUpperCase()}${this.variableName.slice(
      1
    )}`;
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
  }

  static fromStruct(
    typeDefinition: StructDefinition | undefined,
    struct: StructType | ArrayType,
    sourceUnit: WrappedSourceUnit,
    gasToCodePreferenceRatio?: number,
    defaultSelectionForSameScore?: "leastgas" | "leastcode",
    withMemory = true
  ): PackedStackTypeGenerator {
    const generator = new PackedStackTypeGenerator(
      typeDefinition,
      struct,
      sourceUnit,
      gasToCodePreferenceRatio,
      defaultSelectionForSameScore
    );
    generator.createPackFunction();
    generator.createUnpackFunction();
    generator.createEqFunction();
    for (const position of generator.storagePositions) {
      generator.createReadParameterFunction(position);
      generator.createWriteParameterFunction(position);
    }
    if (withMemory) {
      generator.createWriteToMemory();
    }

    return generator;
  }

  get memberBytes(): number {
    return this.storagePositions.reduce((t, p) => t + p.bytesLength, 0);
  }

  get numSlots(): number {
    return Math.max(...this.storagePositions.map((p) => p.slot)) + 1;
  }

  createEqFunction(): string {
    const otherVariableName = `other${this.variableName[0].toUpperCase()}${this.variableName.slice(
      1
    )}`;
    const body = [`assembly {`, [`isEqual := eq(${this.variableName}, ${otherVariableName})`], `}`];
    return this.ctx.addInternalFunction(
      `eq`,
      `${this.cacheTypeName} ${this.variableName}, ${this.cacheTypeName} ${otherVariableName}`,
      "bool isEqual",
      body,
      FunctionStateMutability.Pure,
      [`/// Check if two ${this.cacheTypeName}s are equal`]
    );
  }

  createReadParameterFunction(position: StoragePosition): string {
    const label = position.label.split(".").pop() as string;
    const varName = `_${label}`;
    const returnValue = position.type.writeParameter(DataLocation.Default, varName);
    console.log(`Trying to encode ${label}`);
    const accessor = getReadFromStackAccessor({
      dataReference: `${this.variableName}`,
      leftAligned: position.type.leftAligned,
      bitsOffset: position.parentOffsetBits,
      bitsLength: position.bitsLength,
      gasToCodePreferenceRatio: this.gasToCodePreferenceRatio,
      defaultSelectionForSameScore: this.defaultSelectionForSameScore
    });

    const body = `assembly { ${varName} := ${accessor} }`;
    return this.ctx.addInternalFunction(
      label,
      `${this.cacheTypeName} ${this.variableName}`,
      returnValue,
      body,
      FunctionStateMutability.Pure,
      [`/// Extract ${label} from ${this.variableName}`]
    );
  }

  createPackFunction(): string {
    const expression = packWord(this.storagePositions);
    const body = [`assembly {`, [`${this.variableName} := ${expression}`], `}`];
    const params = this.storagePositions.map((p) =>
      p.type.writeParameter(DataLocation.Default, p.label)
    );
    const names = this.storagePositions.map((p) => p.label);
    return this.ctx.parent.addInternalFunction(
      `encode${this.type.identifier[0].toUpperCase()}${this.type.identifier.slice(1)}`,
      params.join(", "),
      `${this.cacheTypeName} ${this.variableName}`,
      body,
      FunctionStateMutability.Pure,
      [`/// Encode \`${names.join(", ")}\` members into a ${this.cacheTypeName}`]
    );
  }

  createWriteToMemory(): string {
    const memoryVariableName = this.updatedVariableName.replace("new", "memory");
    const body = [
      `assembly {`,
      [
        `${memoryVariableName} := mload(0x40)`,
        `mstore(${memoryVariableName}, ${this.variableName})`,
        `mstore(0x40, add(${memoryVariableName}, 0x20))`
      ],
      `}`
    ];
    return this.ctx.addInternalFunction(
      `toMemory`,
      `${this.cacheTypeName} ${this.variableName}`,
      `${this.cacheTypeName} ${memoryVariableName}`,
      body,
      FunctionStateMutability.Pure,
      [`/// Copy ${this.cacheTypeName} to memory`]
    );
  }

  createUnpackFunction(): string {
    const asmBody: StructuredText[] = [];
    const outputs: StructuredText[] = [];
    for (const position of this.storagePositions) {
      const accessor = getReadFromStackAccessor({
        dataReference: `${this.variableName}`,
        leftAligned: position.type.leftAligned,
        bitsOffset: position.parentOffsetBits,
        bitsLength: position.bitsLength,
        gasToCodePreferenceRatio: this.gasToCodePreferenceRatio,
        defaultSelectionForSameScore: this.defaultSelectionForSameScore
      });
      const varName = `_${position.label}`;
      asmBody.push(`${varName} := ${accessor}`);
      outputs.push(position.type.writeParameter(DataLocation.Default, varName));
    }
    const names = this.storagePositions.map((p) => p.label);
    return this.ctx.addInternalFunction(
      `decode${this.type.identifier[0].toUpperCase()}${this.type.identifier.slice(1)}`,
      `${this.cacheTypeName} ${this.variableName}`,
      outputs.join(", "),
      [`assembly {`, asmBody, `}`],
      FunctionStateMutability.Pure,
      [`/// Extract \`${names.join(", ")}\` members from a ${this.cacheTypeName}`]
    );
  }

  createWriteParameterFunction(position: StoragePosition): string {
    const label = position.label.split(".").pop() as string;
    const varName = `_${label}`;
    const newValueParameter = position.type.writeParameter(DataLocation.Memory, varName);
    const accessor = getWriteToStackAccessor({
      dataReference: `${this.variableName}`,
      leftAligned: position.type.leftAligned,
      bitsOffset: position.parentOffsetBits,
      bitsLength: position.bitsLength,
      value: varName,
      gasToCodePreferenceRatio: this.gasToCodePreferenceRatio,
      defaultSelectionForSameScore: this.defaultSelectionForSameScore
    });
    const body = [
      `assembly {`,
      [`/// Overwrite ${label}`, `${this.updatedVariableName} := ${accessor}`],
      `}`
    ];
    return this.ctx.addInternalFunction(
      `set${label[0].toUpperCase()}${label.slice(1)}`,
      `${this.cacheTypeName} ${this.variableName}, ${newValueParameter}`,
      `${this.cacheTypeName} ${this.updatedVariableName}`,
      body,
      FunctionStateMutability.Pure,
      [
        `/// Returns new ${this.cacheTypeName} with \`${label}\` set to \`${varName}\``,
        `/// Note: This function does not modify the original ${this.cacheTypeName}`
      ]
    );
  }
}

async function test() {
  const h = await CompileHelper.fromFiles(
    new Map([
      [
        "OldMarketState.sol",
        `struct RoleProvider {
             uint32 roleTimeToLive;
             address providerAddress;
             uint24 pullProviderIndex;
           }`
      ]
    ]),
    `OldMarketState.sol`
  );

  const sourceUnit = WrappedSourceUnit.getWrapper(h, h.getSourceUnit("OldMarketState.sol"));
  const typeDefinition = sourceUnit.scope.getChildrenByType(StructDefinition)[0];
  const type = readTypeNodesFromSolcAST(false, sourceUnit.scope).structs[0] as StructType;
  const generator = PackedStackTypeGenerator.fromStruct(
    typeDefinition,
    type,
    WrappedSourceUnit.getWrapper(h, `RoleProvider.sol`)
  );

  await generator.ctx.applyPendingFunctions();
  const codeOut = new ASTWriter(
    DefaultASTWriterMapping,
    new PrettyFormatter(2),
    LatestCompilerVersion
  ).write(generator.ctx.sourceUnit);
  console.log(codeOut);
  writeFileSync(path.join(__dirname, `RoleProvider.sol`), codeOut);
}

// test();
