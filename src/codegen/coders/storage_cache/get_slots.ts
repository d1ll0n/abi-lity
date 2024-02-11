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
import { ArrayType, StructType, TypeNode, UValueType, ValueType, isUValueType } from "../../../ast";
import { addDefinitionImports, coerceArray, getInclusionMask, toHex } from "../../../utils";
import { readTypeNodesFromSolcAST, readTypeNodesFromSolidity } from "../../../readers";
import {
  WrappedContract,
  WrappedScope,
  WrappedSourceUnit,
  wrapScope
} from "../../ctx/contract_wrapper";
import { getOffsetYulExpression } from "../../offsets";
import NameGen, { toPascalCase } from "../../names";
import { getReadFromMemoryAccessor } from "./accessors/read_options";
import { getWriteToMemoryAccessor } from "./accessors/write_options";
import { add } from "./accessors/utils";
import { CompileHelper } from "../../../utils/compile_utils/compile_helper";

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

type StoragePosition = {
  slot: number;
  slotOffsetBytes: number;
  parentOffsetBytes: number;
  bytesLength: number;
  label: string;
  type: ValueType;
} & (
  | {
      arrayParentId: number;
      arrayIndex: number;
    }
  | {
      arrayParentId?: undefined;
      arrayIndex?: undefined;
    }
);

class StorageField<T extends number | undefined = undefined> {
  public arrayParentId: T;
  public arrayIndex: T;
  constructor(
    public slot: number,
    public slotOffsetBytes: number,
    public bytesLength: number,
    public label: string,
    public type: ValueType,
    arrayParentId?: T,
    arrayIndex?: T
  ) {
    this.arrayIndex = arrayIndex as T;
    this.arrayParentId = arrayParentId as T;
  }
}

class StoragePositionTracker {
  slot = 0;
  slotOffsetBytes = 0;
  positions: StoragePosition[] = [];

  forceNextSlot() {
    if (this.slotOffsetBytes !== 0) {
      this.slot++;
      this.slotOffsetBytes = 0;
    }
  }

  visitValueType(field: UValueType): StoragePosition {
    assert(field.labelFromParent !== undefined, "Expected field to have a label");
    const bytesLength = field.exactBytes as number;
    if (this.slotOffsetBytes + bytesLength > 31) {
      this.slot++;
      this.slotOffsetBytes = 0;
    }
    const position = {
      slot: this.slot,
      slotOffsetBytes: this.slotOffsetBytes,
      parentOffsetBytes: this.slot * 32 + this.slotOffsetBytes,
      bytesLength,
      label: field.labelFromParent,
      type: field
    };
    this.slotOffsetBytes += bytesLength;
    return position;
  }

  visitStruct(field: StructType): StoragePosition[] {
    // @todo Implement dynamic struct storage cache
    assert(
      field.exactBytes !== undefined,
      `Unsupported operation: generate storage cache object for dynamic struct ${field.writeDefinition()}`
    );
    const labelPrefix = field.labelFromParent ? `${field.labelFromParent}.` : "";
    this.forceNextSlot();
    const positions = this.visit(field.vMembers);
    for (const position of positions) {
      position.label = `${labelPrefix}${position.label}`;
    }
    return positions;
  }

  visitArray(field: ArrayType): StoragePosition[] {
    assert(field.labelFromParent !== undefined, "Expected field to have a label");
    this.forceNextSlot();
    const child = field.baseType;
    // @todo Implement dynamic array storage cache
    assert(field.length !== undefined, "Expected array to have a length");
    const positions: StoragePosition[] = [];
    for (let i = 0; i < field.length; i++) {
      const element = child.copy();
      element.parent = field;
      element.labelFromParent = `${field.labelFromParent}[${i}]`;
      const childPositions = this.visit(element);
      for (const position of childPositions) {
        position.arrayParentId = field.id;
        position.arrayIndex = i;
      }
      positions.push(...childPositions);
    }
    return positions;
  }

  visit(fields: TypeNode | TypeNode[]) {
    fields = coerceArray(fields);
    const positions: StoragePosition[] = [];
    for (const field of fields) {
      if (field instanceof StructType) {
        positions.push(...this.visitStruct(field));
      } else if (field instanceof ArrayType) {
        positions.push(...this.visitArray(field));
      } else if (isUValueType(field)) {
        positions.push(this.visitValueType(field));
      }
    }
    return positions;
  }

  static getPositions(struct: StructType | ArrayType) {
    const tracker = new StoragePositionTracker();
    return tracker.visit(struct);
  }
}

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
    this.storagePositions = StoragePositionTracker.getPositions(type);
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
    const absoluteOffsetBytes = position.parentOffsetBytes + this.numSlots;
    const returnValue = position.type.writeParameter(DataLocation.Memory, label);
    const accessor = getReadFromMemoryAccessor(
      `_cache`,
      position.type.leftAligned,
      absoluteOffsetBytes,
      position.bytesLength,
      this.gasToCodePreferenceRatio,
      this.defaultSelectionForSameScore
    );

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
    const accessor = getWriteToMemoryAccessor(
      `_cache`,
      position.type.leftAligned,
      absoluteOffsetBytes,
      position.bytesLength,
      label,
      this.gasToCodePreferenceRatio,
      this.defaultSelectionForSameScore
    );
    const slotPointer = add(`_cache`, position.slot);
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
    const body = [];
    const numFlagWords = Math.ceil(this.numSlots / 32);

    for (let i = 0; i < numFlagWords; i++) {
      body.push(`${i === 0 ? "let " : ""}flags := mload(${add("_cache", i)})`);
      const firstSlot = i * 32;
      const lastByteToCheck = Math.min((i + 1) * 32, this.numSlots) - firstSlot;
      for (let j = 0; j < lastByteToCheck; j++) {
        const slot = firstSlot + j;
        const slotMemoryPointer = add(`_cache`, this.numSlots + slot * 32);
        const storagePointer = add(`stored.slot`, slot);
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
  const positions = StoragePositionTracker.getPositions(struct);
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
  const positions = StoragePositionTracker.getPositions(MarketState);
  const printPositions = (positions: StoragePosition[]) => {
    for (const position of positions) {
      const end = position.slotOffsetBytes + position.bytesLength;
      console.log(
        `Slot ${position.slot} | [${position.slotOffsetBytes}:${end}] | ${position.label}`
      );
    }
  };
  // console.log(positions);
  printPositions(positions);
  console.log(`Slots used: ${Math.max(...positions.map((p) => p.slot)) + 1}`);
  console.log("Optimal ordering:");
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

testGenerate();

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
