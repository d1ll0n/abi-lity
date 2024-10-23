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
  assert
} from "solc-typed-ast";
import { ArrayType, StructType, TypeNode } from "../../../ast";
import {
  StructuredText,
  addCommaSeparators,
  addDefinitionImports,
  toHex,
  writeNestedStructure
} from "../../../utils";
import { readTypeNodesFromSolcAST, readTypeNodesFromSolidity } from "../../../readers";
import {
  WrappedContract, WrappedSourceUnit,
  wrapScope
} from "../../ctx/contract_wrapper";
import { getOffsetYulExpression } from "../../offsets";
import NameGen, { toPascalCase } from "../../names";
import { getReadFromMemoryAccessor, getWriteToMemoryAccessor } from "./accessors";
import { yulAdd, yulAlignValue } from "./accessors/utils";
import { CompileHelper } from "../../../utils/compile_utils/compile_helper";
import {
  StoragePosition,
  SolidityStoragePositionsTracker
} from "../../../analysis/solidity_storage_positions";
import _ from "lodash";

// type StoredValuePosition = {
// slot: number;
// slotOffsetBytes: number;
// parentOffsetBytes: number;
// stackBitsBefore: number;
// stackBitsAfter: number;
// bytesLength: number;
// label: string;
// type: ValueType;
// };

class StorageCacheLibraryGenerator {
  storagePositions: StoragePosition[] = [];
  cacheTypeName: string;
  cacheLibraryName: string;
  ctx: WrappedContract;

  constructor(
    public typeDefinition: StructDefinition | undefined,
    public type: StructType | ArrayType,
    sourceUnit: WrappedSourceUnit,
    public gasToCodePreferenceRatio = 3,
    public defaultSelectionForSameScore: "leastgas" | "leastcode" = "leastgas"
  ) {
    this.storagePositions = SolidityStoragePositionsTracker.getPositions(type);
    this.cacheTypeName = NameGen.cacheType(type);
    this.cacheLibraryName = NameGen.cacheTypeLibrary(type);
    this.ctx = sourceUnit.addContract(this.cacheLibraryName, ContractKind.Library);

    this.ctx.addValueTypeDefinition(this.cacheTypeName, false);
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
    sourceUnit: WrappedSourceUnit
  ) {
    const generator = new StorageCacheLibraryGenerator(typeDefinition, struct, sourceUnit);
    generator.createReadFromStorageFunction();
    for (const position of generator.storagePositions) {
      generator.createReadParameterFromMemoryFunction(position);
      generator.createWriteParameterToMemoryFunction(position);
    }
    generator.createWriteToStorageFunction();
    return generator;
  }

  get memberBytes() {
    return this.storagePositions.reduce((t, p) => t + p.bytesLength, 0);
  }

  get numSlots() {
    return Math.max(...this.storagePositions.map((p) => p.slot)) + 1;
  }

  addCacheReadGlobalFunction() {
    // const sourceUnit = this.typeDefinition.getClosestParentByType(SourceUnit);
    // if (sourceUnit && )
    if (this.typeDefinition?.parent instanceof SourceUnit) {
      // const fn = this.createReadFromStorageFunction();
      // this.typeDefinition.parent.addFunction(fn);
      addDefinitionImports(this.typeDefinition.parent, [this.ctx.scope]);
      const scope = wrapScope(this.ctx.helper, this.typeDefinition.parent);
      scope.addCustomTypeUsingForDirective(this.typeDefinition.name);
    }
  }

  createReadFromStorageFunction(): string {
    const bytesToAllocate = Math.ceil((this.memberBytes + this.numSlots) / 32) * 32;
    const assemblyBody = [
      `_cache := mload(0x40)`,
      `// Reserve space for the struct and the flags for updated slots`,
      `mstore(0x40, add(_cache, ${toHex(bytesToAllocate)}))`,
      `// Ensure the flags are zeroed`,
      `mstore(_cache, 0)`,
      `// Read each storage value into memory`
    ];
    for (let i = 0; i < this.numSlots; i++) {
      const memPointer = getOffsetYulExpression(`_cache`, i * 32 + this.numSlots);
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
    const absoluteOffsetBits = position.parentOffsetBits + this.numSlots;
    const returnValue = position.type.writeParameter(DataLocation.Memory, label);
    const accessor = getReadFromMemoryAccessor({
      dataReference: `_cache`,
      leftAligned: position.type.leftAligned,
      bitsOffset: absoluteOffsetBits,
      bitsLength: position.bytesLength * 8,
      gasToCodePreferenceRatio: this.gasToCodePreferenceRatio,
      defaultSelectionForSameScore: this.defaultSelectionForSameScore
    });

    const body = `assembly { ${label} := ${accessor} }`;
    return this.ctx.addInternalFunction(
      `get${toPascalCase(label)}`,
      `${this.cacheTypeName} _cache`,
      returnValue,
      body,
      FunctionStateMutability.Pure
    );
  }

  createWriteParameterToMemoryFunction(position: StoragePosition): string {
    const label = position.label.split(".").pop() as string;
    const absoluteOffsetBytes = position.parentOffsetBytes + this.numSlots;
    const newValueParameter = position.type.writeParameter(DataLocation.Memory, label);
    const accessor = getWriteToMemoryAccessor({
      dataReference: `_cache`,
      leftAligned: position.type.leftAligned,
      bitsOffset: absoluteOffsetBytes * 8,
      bitsLength: position.bytesLength * 8,
      value: label,
      gasToCodePreferenceRatio: this.gasToCodePreferenceRatio,
      defaultSelectionForSameScore: this.defaultSelectionForSameScore
    });
    const slotPointer = yulAdd(`_cache`, position.slot);
    const body = [
      `assembly {`,
      [
        `// Update slot update flag`,
        `mstore8(${slotPointer}, 1)`,
        `// Overwrite ${label} in cache`,
        ...accessor.split("\n")
      ],
      `}`
    ];
    return this.ctx.addInternalFunction(
      `set${toPascalCase(label)}`,
      `${this.cacheTypeName} _cache, ${newValueParameter}`,
      undefined,
      body,
      FunctionStateMutability.Pure
    );
  }

  createWriteToStorageFunction(): string {
    const body: string[] = [];
    const numFlagWords = Math.ceil(this.numSlots / 32);

    for (let i = 0; i < numFlagWords; i++) {
      body.push(`${i === 0 ? "let " : ""}flags := mload(${yulAdd("_cache", i)})`);
      const firstSlot = i * 32;
      const lastByteToCheck = Math.min((i + 1) * 32, this.numSlots) - firstSlot;
      for (let j = 0; j < lastByteToCheck; j++) {
        const slot = firstSlot + j;
        const slotMemoryPointer = yulAdd(`_cache`, this.numSlots + slot * 32);
        const storagePointer = yulAdd(`stored.slot`, slot);
        body.push(
          `if byte(${j}, flags) { sstore(${storagePointer}, mload(${slotMemoryPointer})) }`
        );
      }
    }
    body.push(
      `// Clear the cache update flags`,
      `calldatacopy(_cache, calldatasize(), ${this.numSlots})`
    );

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

export function optimizeStruct(struct: StructType): StructType {
  const positions = SolidityStoragePositionsTracker.getPositions(struct);
  const optimizedSlots = optimizeStoragePositions([...positions.map((p) => ({ ...p }))]);
  const optimizedPositions = optimizedSlots.flat();

  return rebuildStruct(struct, optimizedPositions);
}

async function test() {
  const reader = readTypeNodesFromSolidity(`struct MarketState {
    bool isClosed;
    uint128 maxTotalSupply;
    uint128 accruedProtocolFees;
    // Underlying assets reserved for withdrawals which have been paid
    // by the borrower but not yet executed.
    uint128 normalizedUnclaimedWithdrawals;
    // Scaled token supply (divided by scaleFactor)
    uint104 scaledTotalSupply;
    // Scaled token amount in withdrawal batches that have not been
    // paid by borrower yet.
    uint104 scaledPendingWithdrawals;
    uint32 pendingWithdrawalExpiry;
    // Whether market is currently delinquent (liquidity under requirement)
    bool isDelinquent;
    // Seconds borrower has been delinquent
    uint32 timeDelinquent;
    // Annual interest rate accrued to lenders, in basis points
    uint16 annualInterestBips;
    // Percentage of outstanding balance that must be held in liquid reserves
    uint16 reserveRatioBips;
    // Ratio between internal balances and underlying token amounts
    uint112 scaleFactor;
    uint32 lastInterestAccruedTimestamp;
  }`);
  const MarketState = reader.structs[0];
  MarketState.labelFromParent = "state";
  const positions = SolidityStoragePositionsTracker.getPositions(MarketState);
  const printPositions = (allPositions: StoragePosition[]) => {
    const alignments: StructuredText[] = [];
    const positionsBySlot = _(allPositions)
      .groupBy((p) => p.slot)
      .toArray()
      .value();
    for (const slot of positionsBySlot) {
      const positions = [...slot];
      positions.reverse();
      const arr: StructuredText[] = [];
      for (const position of positions) {
        const end = position.slotOffsetBytes + position.bytesLength;
        const realStart = 32 - end;
        const realEnd = realStart + position.bytesLength;
        console.log(`Slot ${position.slot} | [${realStart}:${realEnd}] | ${position.label}`);
        const x = yulAlignValue(position.label, position.bitsLength, false, realStart * 8);
        arr.push(x);
      }
      const slotNumber = positions[0].slot;
      while (arr.length > 1) {
        const next = arr.splice(0, 2);
        arr.unshift([`or(`, addCommaSeparators(next), `)`]);
      }
      alignments.push(`sstore(`, [`add(_state.slot, ${slotNumber}),`, ...arr], `)`);
    }
    console.log(writeNestedStructure(alignments));
  };
  // console.log(positions);
  printPositions(positions);
  console.log(`Slots used: ${Math.max(...positions.map((p) => p.slot)) + 1}`);
  console.log("Optimal ordering:");
  // Temporary: skip optimization
  if (positions.length) return;
  const optimizedSlots = optimizeStoragePositions([...positions.map((p) => ({ ...p }))]);
  // console.log(positions);
  for (const slot of optimizedSlots) {
    printPositions(slot);
  }
  console.log(`Slots used: ${optimizedSlots.length}`);
  const optimizedSlots2 = optimizeStoragePositions1([...positions.map((p) => ({ ...p }))]);
  if (optimizedSlots.length !== optimizedSlots2.length) {
    console.log(`Different number of slots: ${optimizedSlots.length} vs ${optimizedSlots2.length}`);
  }
  for (let i = 0; i < optimizedSlots2.length; i++) {
    const slot1 = optimizedSlots[i];
    const slot2 = optimizedSlots2[i];
    if (slot1.length !== slot2.length) {
      console.log(`Different number of elements in slot ${i}: ${slot1.length} vs ${slot2.length}`);
    } else {
      for (let j = 0; j < slot1.length; j++) {
        const position1 = slot1[j];
        const position2 = slot2[j];
        if (position1.label !== position2.label) {
          console.log(
            `Different label for position ${i}.${j}: ${position1.label} vs ${position2.label}`
          );
        }
      }
    }
  }
  const optimizedPositions = optimizedSlots.flat();
  rebuildStruct(MarketState, optimizedPositions);
}

// test();

async function testGenerate() {
  const h = await CompileHelper.fromFiles(
    new Map([
      [
        "MarketState.sol",
        `struct MarketState {
      bool isClosed;
      uint128 maxTotalSupply;
      uint128 accruedProtocolFees;
      // Underlying assets reserved for withdrawals which have been paid
      // by the borrower but not yet executed.
      uint128 normalizedUnclaimedWithdrawals;
      // Scaled token supply (divided by scaleFactor)
      uint104 scaledTotalSupply;
      // Scaled token amount in withdrawal batches that have not been
      // paid by borrower yet.
      uint104 scaledPendingWithdrawals;
      uint32 pendingWithdrawalExpiry;
      // Whether market is currently delinquent (liquidity under requirement)
      bool isDelinquent;
      // Seconds borrower has been delinquent
      uint32 timeDelinquent;
      // Annual interest rate accrued to lenders, in basis points
      uint16 annualInterestBips;
      // Percentage of outstanding balance that must be held in liquid reserves
      uint16 reserveRatioBips;
      // Ratio between internal balances and underlying token amounts
      uint112 scaleFactor;
      uint32 lastInterestAccruedTimestamp;
    }`
      ]
    ]),
    `MarketState.sol`
  );
  const sourceUnit = WrappedSourceUnit.getWrapper(h, h.getSourceUnit("MarketState.sol"));
  const typeDefinition = sourceUnit.scope.getChildrenByType(StructDefinition)[0];
  const type = readTypeNodesFromSolcAST(false, sourceUnit.scope).structs[0] as StructType;
  const reader = readTypeNodesFromSolidity(`struct MarketState {
    bool isClosed;
    uint128 maxTotalSupply;
    uint128 accruedProtocolFees;
    // Underlying assets reserved for withdrawals which have been paid
    // by the borrower but not yet executed.
    uint128 normalizedUnclaimedWithdrawals;
    // Scaled token supply (divided by scaleFactor)
    uint104 scaledTotalSupply;
    // Scaled token amount in withdrawal batches that have not been
    // paid by borrower yet.
    uint104 scaledPendingWithdrawals;
    uint32 pendingWithdrawalExpiry;
    // Whether market is currently delinquent (liquidity under requirement)
    bool isDelinquent;
    // Seconds borrower has been delinquent
    uint32 timeDelinquent;
    // Annual interest rate accrued to lenders, in basis points
    uint16 annualInterestBips;
    // Percentage of outstanding balance that must be held in liquid reserves
    uint16 reserveRatioBips;
    // Ratio between internal balances and underlying token amounts
    uint112 scaleFactor;
    uint32 lastInterestAccruedTimestamp;
  }`);
  const MarketState = reader.structs[0];
  MarketState.labelFromParent = "state";
  console.log(MarketState.writeDefinition());

  const generator = StorageCacheLibraryGenerator.fromStruct(
    typeDefinition,
    MarketState,
    sourceUnit
  );
  await generator.ctx.applyPendingFunctions();
  const codeOut = new ASTWriter(
    DefaultASTWriterMapping,
    new PrettyFormatter(2),
    LatestCompilerVersion
  ).write(generator.ctx.sourceUnit);
  console.log(codeOut);
}

// testGenerate();

function optimizeStoragePositions(positions: StoragePosition[]): StoragePosition[][] {
  const MAX_SLOT_SIZE = 32;
  const slots: StoragePosition[][] = [];

  const { arrayGroups, individualElements } = separateElements(positions);

  // Sort individual elements by bytesLength in descending order
  individualElements.sort((a, b) => b.bytesLength - a.bytesLength);

  // Allocate individual elements to existing slots
  individualElements.forEach((element) => {
    const slotsWithSpace = slots.filter((slot) => getAvailableSize(slot) >= element.bytesLength);
    slotsWithSpace.sort((a, b) => getAvailableSize(a) - getAvailableSize(b));
    const bestFit = slotsWithSpace[0];
    if (bestFit) {
      bestFit.push(element);
    } else {
      slots.push([element]);
    }
  });

  // Allocate arrays to new slots
  arrayGroups.forEach((group) => {
    let currentSlotSize = 0;
    let currentSlot: StoragePosition[] = [];

    group.forEach((item) => {
      if (currentSlotSize + item.bytesLength > MAX_SLOT_SIZE) {
        slots.push(currentSlot);
        currentSlot = [];
        currentSlotSize = 0;
      }
      currentSlot.push(item);
      currentSlotSize += item.bytesLength;
    });

    if (currentSlotSize > 0) {
      slots.push(currentSlot);
    }
  });

  for (let i = 0; i < slots.length; i++) {
    let slotOffsetBytes = 0;
    for (const position of slots[i]) {
      position.slot = i;
      position.slotOffsetBytes = slotOffsetBytes;
      slotOffsetBytes += position.bytesLength;
    }
  }

  return slots;
}

function optimizeStoragePositions1(positions: StoragePosition[]): StoragePosition[][] {
  const MAX_SLOT_SIZE = 32;
  const slots: StoragePosition[][] = [];

  const { arrayGroups, individualElements } = separateElements(positions);

  // Sort individual elements by bytesLength in descending order
  individualElements.sort((a, b) => b.bytesLength - a.bytesLength);

  // Allocate arrays to new slots
  arrayGroups.forEach((group) => {
    let currentSlotSize = 0;
    let currentSlot: StoragePosition[] = [];

    group.forEach((item) => {
      if (currentSlotSize + item.bytesLength > MAX_SLOT_SIZE) {
        slots.push(currentSlot);
        currentSlot = [];
        currentSlotSize = 0;
      }
      currentSlot.push(item);
      currentSlotSize += item.bytesLength;
    });

    if (currentSlotSize > 0) {
      slots.push(currentSlot);
    }
  });

  // Allocate individual elements to existing slots
  individualElements.forEach((element) => {
    let allocated = false;

    for (const slot of slots) {
      if (getTotalSize(slot) + element.bytesLength <= MAX_SLOT_SIZE) {
        slot.push(element);
        allocated = true;
        break;
      }
    }

    if (!allocated) {
      slots.push([element]);
    }
  });

  for (let i = 0; i < slots.length; i++) {
    let slotOffsetBytes = 0;
    for (const position of slots[i]) {
      position.slot = i;
      position.slotOffsetBytes = slotOffsetBytes;
      slotOffsetBytes += position.bytesLength;
    }
  }

  return slots;
}

function separateElements(positions: StoragePosition[]): {
  arrayGroups: StoragePosition[][];
  individualElements: StoragePosition[];
} {
  const arrayGroups: { [parentId: number]: StoragePosition[] } = {};
  const individualElements: StoragePosition[] = [];

  positions.forEach((position) => {
    if (position.arrayParentId !== undefined) {
      if (!arrayGroups[position.arrayParentId]) {
        arrayGroups[position.arrayParentId] = [];
      }
      arrayGroups[position.arrayParentId].push(position);
    } else {
      individualElements.push(position);
    }
  });

  return {
    arrayGroups: Object.values(arrayGroups),
    individualElements
  };
}

function getTotalSize(positions: StoragePosition[]): number {
  return positions.reduce((total, position) => total + position.bytesLength, 0);
}

function getAvailableSize(positions: StoragePosition[]): number {
  return 32 - getTotalSize(positions);
}

function rebuildStruct(struct: StructType, positions: StoragePosition[]): StructType {
  const newStruct = struct.copy();
  // const members = newStruct.children as TypeNode[];
  const newMembers = positions
    .filter((p) => p.arrayParentId === undefined || p.arrayIndex === 0)
    .map((p) => (p.arrayParentId === undefined ? p.type : p.type.parent) as TypeNode);
  assert(newMembers.length === newStruct.vMembers.length, "Expected same number of members");
  for (let i = 0; i < newMembers.length; i++) {
    newStruct.replaceChild(newStruct.vMembers[i], newMembers[i]);
  }
  console.log(newStruct.writeDefinition());
  return newStruct;
}
test();
