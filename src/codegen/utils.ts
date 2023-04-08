import { findIndex } from "lodash";
import {
  assert,
  ASTNodeFactory,
  ContractDefinition,
  ContractKind,
  DataLocation,
  Expression,
  FunctionCall,
  FunctionCallKind,
  FunctionDefinition,
  Identifier,
  IdentifierPath,
  isInstanceOf,
  LatestCompilerVersion,
  SourceUnit,
  staticNodeFactory,
  UserDefinedValueTypeDefinition,
  YulExpression,
  YulIdentifier
} from "solc-typed-ast";
import {
  ArrayType,
  ErrorType,
  EventType,
  FunctionType,
  StructType,
  TupleType,
  TypeNode,
  ValueType
} from "../ast";
import {
  CompileHelper,
  findContractDefinition,
  findFunctionDefinition,
  FunctionAddition,
  getConstant,
  getInclusiveRangeWith,
  getYulConstant,
  StructuredText,
  toHex,
  writeNestedStructure
} from "../utils";
import { isExternalFunction } from "./abi_decode";

const PointerLibraries = require("./PointerLibraries.json");

export class CodegenContext {
  pendingFunctions: FunctionAddition[] = [];
  contracts: ContractCodegenContext[] = [];
  originalFiles: string[] = [];

  constructor(public helper: CompileHelper, public decoderSourceUnitName: string) {
    this.helper.addSourceUnit(decoderSourceUnitName);
    const sourceUnit = this.sourceUnit;
    if (sourceUnit.children.length === 0) {
      const [, major, minor] = LatestCompilerVersion.split(".");
      sourceUnit.insertAtBeginning(
        staticNodeFactory.makePragmaDirective(sourceUnit.requiredContext, [
          "solidity",
          "^",
          `0.${major}`,
          `.${minor}`
        ])
      );
    }
  }

  addPointerLibraries(): void {
    this.helper.addSourceUnit("PointerLibraries.sol", writeNestedStructure(PointerLibraries));
    this.helper.addImport(this.decoderSourceUnitName, "PointerLibraries.sol");
  }

  get decoderSourceUnit(): SourceUnit {
    return this.helper.getSourceUnit(this.decoderSourceUnitName);
  }

  get sourceUnit(): SourceUnit {
    return this.decoderSourceUnit;
  }

  addValueTypeDefinition(name: string): UserDefinedValueTypeDefinition {
    const existing = this.sourceUnit.vUserDefinedValueTypes.find((v) => v.name === name);
    if (existing) return existing;
    const type = staticNodeFactory.makeUserDefinedValueTypeDefinition(
      this.sourceUnit.requiredContext,
      name,
      staticNodeFactory.makeTypeNameUint256(this.sourceUnit.requiredContext)
    );
    this.sourceUnit.appendChild(type);

    return type;
  }

  addCustomTypeUsingForDirective(
    name: string,
    libraryName?: IdentifierPath,
    functionList?: IdentifierPath[]
  ): void {
    const type = this.sourceUnit
      .getChildrenByType(UserDefinedValueTypeDefinition)
      .find((child) => child.name === name);
    assert(type !== undefined, `Type ${name} not found`);
    const typeName = staticNodeFactory.makeUserDefinedTypeName(
      this.sourceUnit.requiredContext,
      type.name,
      type.name,
      type.id,
      staticNodeFactory.makeIdentifierPath(this.sourceUnit.requiredContext, name, type.id)
    );
    const usingFor = staticNodeFactory.makeUsingForDirective(
      this.sourceUnit.requiredContext,
      true,
      libraryName,
      functionList,
      typeName
    );
    this.sourceUnit.insertAfter(usingFor, type);
  }

  getConstant(name: string, value: number | string): Identifier {
    return getConstant(this.decoderSourceUnit, name, value);
  }

  addConstant(name: string, value: number | string): string {
    return this.getConstant(name, value).name;
  }

  getYulConstant(name: string, value: number | string): YulIdentifier {
    return getYulConstant(this.decoderSourceUnit, name, value);
  }

  hasFunction(name: string): boolean {
    return Boolean(findFunctionDefinition(this.decoderSourceUnit, name));
  }

  applyPendingFunctions(): void {
    const fns = this.pendingFunctions;
    if (fns.length === 0) return;
    this.helper.addFunctionCode(this.decoderSourceUnitName, fns);
    this.pendingFunctions = [];
  }

  addFunction(name: string, code: StructuredText, applyImmediately?: boolean): string {
    if (!this.pendingFunctions.find((fn) => fn.name === name)) {
      this.pendingFunctions.push({ code: writeNestedStructure(code), name });
    }
    if (applyImmediately) {
      this.applyPendingFunctions();
    }
    return name;
  }

  hasContract(name: string): boolean {
    return Boolean(findContractDefinition(this.sourceUnit, name));
  }

  addContract(name: string, kind: ContractKind): ContractCodegenContext {
    let contract = this.contracts.find((c) => c.name === name);
    if (!contract) {
      contract = new ContractCodegenContext(this, name, kind);
      this.contracts.push(contract);
    }
    return contract;
  }

  applyPendingContracts(): void {
    const contractFunctions: Array<{
      contractName: string;
      _functions: FunctionAddition[] | FunctionAddition;
    }> = [];
    for (const contract of this.contracts) {
      const _functions = contract.pendingFunctions;
      if (_functions.length === 0) continue;
      contractFunctions.push({
        contractName: contract.name,
        _functions
      });
      contract.pendingFunctions = [];
    }
    if (contractFunctions.length === 0) return;
    this.helper.updateMultipleContracts(this.decoderSourceUnitName, contractFunctions);
  }
}

export class ContractCodegenContext {
  pendingFunctions: FunctionAddition[] = [];
  contract: ContractDefinition;

  constructor(
    public sourceUnitContext: CodegenContext,
    public name: string,
    public kind: ContractKind
  ) {
    const sourceUnit = sourceUnitContext.decoderSourceUnit;
    let contract: ContractDefinition | undefined = findContractDefinition(sourceUnit, name);
    if (contract === undefined) {
      contract = staticNodeFactory.makeContractDefinition(
        sourceUnit.requiredContext,
        name,
        sourceUnit.id,
        kind,
        false,
        true,
        [],
        []
      );
      sourceUnit.appendChild(contract);
    }
    this.contract = contract;
  }

  get helper(): CompileHelper {
    return this.sourceUnitContext.helper;
  }

  get sourceUnit(): SourceUnit {
    return this.sourceUnitContext.decoderSourceUnit;
  }

  get sourceUnitName(): string {
    return this.sourceUnitContext.decoderSourceUnitName;
  }

  addConstant(name: string, value: number | string): string {
    return this.getConstant(name, value).name;
  }

  getConstant(name: string, value: number | string): Identifier {
    return getConstant(this.contract, name, value);
  }

  getYulConstant(name: string, value: number | string): YulIdentifier {
    return getYulConstant(this.contract, name, value);
  }

  hasFunction(name: string): boolean {
    return Boolean(findFunctionDefinition(this.contract, name));
  }

  applyPendingFunctions(): void {
    this.sourceUnitContext.applyPendingFunctions();
    const fns = this.pendingFunctions;
    if (fns.length === 0) return;
    this.helper.addFunctionsToContract(this.sourceUnitName, this.contract.name, fns);
    this.pendingFunctions = [];
  }

  addFunction(name: string, code: StructuredText, applyImmediately?: boolean): string {
    if (!this.pendingFunctions.find((fn) => fn.name === name)) {
      this.pendingFunctions.push({ code: writeNestedStructure(code), name });
    }
    if (applyImmediately) {
      this.applyPendingFunctions();
    }
    return name;
  }
}

const PointerRoundUp32Mask = `0xffffffe0`;

export function roundUpAdd32(ctx: CodegenContext, value: string, asm?: boolean): string;
export function roundUpAdd32(ctx: SourceUnit, value: YulExpression, asm?: boolean): YulExpression;
export function roundUpAdd32(
  ctx: SourceUnit | CodegenContext,
  value: YulExpression | string,
  asm = true
): string | YulExpression {
  if (ctx instanceof CodegenContext && typeof value === "string") {
    const almostTwoWords = ctx.addConstant("AlmostTwoWords", toHex(63));
    const mask = ctx.addConstant("OnlyFullWordMask", PointerRoundUp32Mask);
    if (asm) return `and(add(${value}, ${almostTwoWords}), ${mask})`;
    return `((${value} + ${almostTwoWords}) & ${mask})`;
  } else if (ctx instanceof SourceUnit && value instanceof YulExpression) {
    const mask = getYulConstant(ctx, `OnlyFullWordMask`, PointerRoundUp32Mask);
    const almostTwoWords = getYulConstant(ctx, `AlmostTwoWords`, toHex(63));
    return value.add(almostTwoWords).and(mask);
  }
  throw Error(`Unsupported input types`);
}

export function getMaxValueConstant(ctx: CodegenContext, type: ValueType): string {
  const max = type.max();
  assert(
    max !== undefined,
    `Can not create mask for type ${type.identifier} with undefined maximum`
  );
  return ctx.addConstant(`Max${type.pascalCaseName}`, toHex(max));
}

export function getCalldataDecodingFunction(
  fnName: string,
  inPtr: string,
  outPtr: string,
  body: StructuredText[]
): StructuredText[] {
  return [
    `function ${fnName}(CalldataPointer ${inPtr}) pure returns (MemoryPointer ${outPtr}) {`,
    body,
    `}`
  ];
}

export function getEncodingFunction(
  fnName: string,
  inPtr: string,
  outPtr: string,
  body: StructuredText[]
): StructuredText[] {
  return [
    `function ${fnName}(MemoryPointer ${inPtr}, MemoryPointer ${outPtr}) pure returns (uint256 size) {`,
    body,
    `}`
  ];
}

export function canDeriveSizeInOneStep(type: TypeNode): boolean {
  return type.totalNestedDynamicTypes < 2 && type.totalNestedReferenceTypes < 2;
}

export function canCombineTailCopies(type: TypeNode): boolean {
  // Has to be one of:
  // Struct with no embedded reference types
  // Array of value types
  // bytes or string
  // value type
  return type.totalNestedDynamicTypes < 2 && type.totalNestedReferenceTypes < 2;
}

export function abiEncodingMatchesMemoryLayout(type: TypeNode): boolean {
  return type.totalNestedDynamicTypes < 2 && type.totalNestedReferenceTypes < 2;
}

export function getSequentiallyCopyableSegments(struct: StructType): TypeNode[][] {
  const types = struct.vMembers;
  const firstValueIndex = findIndex(types, (t) => t.isValueType);
  if (firstValueIndex < 0) return [];
  const segments: TypeNode[][] = [];
  let currentSegment: TypeNode[] = [];
  let numDynamic = 0;
  const endSegment = () => {
    if (currentSegment.length) {
      const filtered = getInclusiveRangeWith(currentSegment, (t) => t.isValueType);
      // Sanity check: all types in segment are sequential in calldata/memory
      for (let i = 1; i < filtered.length; i++) {
        const { calldataHeadOffset: cdHead, memoryHeadOffset: mHead } = filtered[i];
        const { calldataHeadOffset: cdHeadLast, memoryHeadOffset: mHeadLast } = filtered[i - 1];
        assert(
          cdHeadLast + 32 === cdHead,
          `Got non-sequential calldata heads: [${i - 1}] = ${cdHeadLast}, [${i}] = ${cdHead}`
        );
        assert(
          mHeadLast + 32 === mHead,
          `Got non-sequential memory heads: [${i - 1}] = ${mHeadLast}, [${i}] = ${mHead}`
        );
      }
      segments.push(filtered);
      currentSegment = [];
    }
    numDynamic = 0;
  };
  for (let i = firstValueIndex; i < types.length; i++) {
    const type = types[i];
    if (type.calldataHeadSize !== 32 || (type.isReferenceType && ++numDynamic > 4)) {
      endSegment();
      continue;
    }
    if (type.isValueType) {
      numDynamic = 0;
    }
    currentSegment.push(type);
    if (i === types.length - 1) {
      endSegment();
    }
  }
  return segments.filter((s) => s.length);
}

function convertToTuple(node: ArrayType) {
  if (node.isDynamicallySized) {
    throw Error(`Can not convert dynamic length array to tuple ${node.pp()}`);
  }
  const length = node.length as number;
  const members = new Array(length).fill(null).map((_, i) => {
    const name = (node.labelFromParent ?? node.identifier).concat(i.toString());
    const base = node.baseType.copy();
    base.labelFromParent = name;
    return base;
  });

  if (node.parent) {
    node.parent.replaceChild(node, ...members);
    return node.parent;
  } else {
    return new TupleType(members);
  }
}

export function convertFixedLengthArraysToTuples<T extends ArrayType | StructType | TupleType>(
  type: T
): TypeNode {
  type.walkChildren((node) => {
    if (node instanceof ArrayType && !node.isDynamicallySized) {
      convertToTuple(node);
    }
  });
  if (type instanceof ArrayType && !type.isDynamicallySized) {
    return convertToTuple(type);
  }
  return type;
}

export function getPointerOffsetExpression(
  factory: ASTNodeFactory,
  ptr: Expression,
  type: TypeNode,
  location: DataLocation
): Expression {
  const fnName =
    location === DataLocation.CallData && type.isDynamicallyEncoded ? "pptr" : "offset";
  const offsetFunction = factory.makeMemberAccess("tuple(uint256)", ptr, fnName, -1);
  const headOffset =
    location === DataLocation.CallData ? type.calldataHeadOffset : type.memoryHeadOffset;
  if (headOffset === 0) {
    if (fnName === "pptr") {
      return factory.makeFunctionCall("", FunctionCallKind.FunctionCall, offsetFunction, []);
    }
    return ptr;
  }
  const offsetLiteral = factory.makeLiteralUint256(
    location === DataLocation.CallData ? type.calldataHeadOffset : type.memoryHeadOffset
  );
  const offsetCall = factory.makeFunctionCall("", FunctionCallKind.FunctionCall, offsetFunction, [
    offsetLiteral
  ]);
  return offsetCall;
}

export function cleanIR(irOptimized: string): string {
  irOptimized = irOptimized
    .replace(/[^]+object ".+_\d+_deployed"\s\{\s+code\s+\{([^]+)\}\s*data ".metadata"[^]+/, "$1")
    .replace(/\/\*\*[^*]+?\*\//g, "")
    .replace(/(\n\s+)?\/\/\/.+/g, "")
    .replace(/(\n\s+)?\/\/.+/g, "");
  const irOptimizedLines = irOptimized.split("\n").filter((ln) => ln.trim().length > 0);
  const numTabs = (/^\s*/.exec(irOptimizedLines[0]) as string[])[0].length;
  irOptimizedLines.forEach((ln, i) => {
    irOptimizedLines[i] = ln.slice(numTabs);
  });
  return irOptimizedLines.join("\n");
}

export function getUniqueTypeNodes<T extends TypeNode>(typeNodes: T[]): T[] {
  const typeMap = new Map<string, T>();
  typeNodes.forEach((type) => {
    if (typeMap.has(type.identifier)) return;
    typeMap.set(type.identifier, type);
  });
  return [...typeMap.values()];
}

/**
 * Extract all types which can be used with ABI coders.
 * Events, errors, functions will have their parameters unrolled.
 * Currently, tuple types are unrolled.
 */
export function extractCoderTypes(inputType: TypeNode): TypeNode[] {
  if (isInstanceOf(inputType, FunctionType, ErrorType, EventType)) {
    if (inputType.parameters) {
      return extractCoderTypes(inputType.parameters);
    }
    return [];
  }
  if (inputType instanceof TupleType) {
    if (inputType.vMembers.length === 1) {
      return extractCoderTypes(inputType.vMembers[0]);
    }
    return inputType.vMembers.reduce(
      (arr, member) => [...arr, ...extractCoderTypes(member)],
      [] as TypeNode[]
    );
  }
  return [inputType];
}

export function dependsOnCalldataLocation(fn: FunctionDefinition): boolean {
  const internalCalls = fn.getChildrenByType(FunctionCall);
  for (const call of internalCalls) {
    const inputArguments = call.vArguments;
    const referencedFunction = call.vReferencedDeclaration as FunctionDefinition;
    // Ignore function if it is external or public
    // @todo This can falsely determine an internal call to a public function is actually external
    if (!referencedFunction || isExternalFunction(referencedFunction)) continue;
    const functionParameters = referencedFunction.vParameters.vParameters;
    for (let i = 0; i < inputArguments.length; i++) {
      // Check if the function requires calldata input
      if (functionParameters[i].storageLocation !== DataLocation.CallData) continue;
      // Check if input argument is one of the function parameters
      const arg = inputArguments[i];
      if (arg instanceof Identifier && arg.vReferencedDeclaration?.parent === fn.vParameters) {
        return true;
      }
    }
  }
  return false;
}
