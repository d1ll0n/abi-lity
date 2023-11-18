/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  ASTNode,
  ASTNodeFactory,
  ContractDefinition,
  ContractKind,
  EnumDefinition,
  FunctionDefinition,
  FunctionStateMutability,
  Identifier,
  IdentifierPath,
  ImportDirective,
  PragmaDirective,
  SourceUnit,
  StructDefinition,
  StructuredDocumentation,
  SymbolAlias,
  TypeName,
  UserDefinedValueTypeDefinition,
  UsingForDirective,
  VariableDeclaration,
  YulIdentifier,
  assert,
  isInstanceOf
} from "solc-typed-ast";
import { CompileHelper } from "../../utils/compile_utils/compile_helper";
import {
  StructuredText,
  addDependencyImports,
  addEnumDefinition,
  addFunctionImports,
  addImports,
  findContractDefinition,
  findFunctionDefinition,
  getConstant,
  getParentSourceUnit,
  getYulConstant,
  writeNestedStructure
} from "../../utils";
import { ConstantKind } from "../../utils/make_constant";
import path from "path";
import { getPointerLibraries, SolidityLibraries } from "../solidity_libraries";
import NameGen, { NameGenKey, NameGenParameters, NameGenTypeParams } from "../names";

export type WrappableScope = ContractDefinition | SourceUnit;

export const SOURCE_UNIT_WRAPPERS = new WeakMap<ASTNode, WrappedSourceUnit>();
export const CONTRACT_WRAPPERS = new WeakMap<ASTNode, WrappedContract>();

export function wrapScope(
  helper: CompileHelper,
  scope: ContractDefinition | SourceUnit,
  outputPath?: string
): WrappedScope {
  if (scope instanceof ContractDefinition) {
    return WrappedContract.getWrapperFromContract(helper, scope, outputPath);
  }
  return WrappedSourceUnit.getWrapper(helper, scope);
}

export abstract class WrappedScope<C extends ContractDefinition | SourceUnit = WrappableScope> {
  public scope: C;
  protected pendingFunctionSignatures: Map<string, boolean> = new Map();

  constructor(public helper: CompileHelper, scope: WrappableScope, public outputPath?: string) {
    this.scope = scope as C;
  }

  get sourceUnit(): SourceUnit {
    if (this.scope instanceof SourceUnit) return this.scope;
    return getParentSourceUnit(this.scope);
  }

  get factory(): ASTNodeFactory {
    return this.helper.factory;
  }

  //@todo refactor the larger functions out of this class

  addValueTypeDefinition(name: string, limitedToScope?: boolean): UserDefinedValueTypeDefinition {
    const target = limitedToScope ? this.scope : this.sourceUnit;
    const existing = target.vUserDefinedValueTypes.find((v) => v.name === name);
    if (existing) return existing;
    const type = this.factory.makeUserDefinedValueTypeDefinition(
      name,
      this.factory.makeTypeNameUint256()
    );
    target.appendChild(type);

    return type;
  }

  addCustomTypeUsingForDirective(
    name: string,
    libraryName?: IdentifierPath,
    functionList?: IdentifierPath[],
    isGlobal = this.scope instanceof SourceUnit,
    referenced_id?: number
  ): void {
    const target = isGlobal ? this.sourceUnit : this.scope;
    const type = target
      .getChildrenByType(UserDefinedValueTypeDefinition)
      .find((child) => child.name === name);
    let typeName: TypeName | undefined;
    if (referenced_id) {
      assert(type !== undefined, `Type ${name} not found`);
      referenced_id = type.id;
      typeName = this.factory.makeUserDefinedTypeName(
        name,
        name,
        referenced_id,
        this.factory.makeIdentifierPath(name, referenced_id)
      );
    } else {
      typeName = this.factory.makeElementaryTypeName(name, name);
    }
    const usingFor = this.factory.makeUsingForDirective(
      isGlobal,
      libraryName,
      functionList,
      typeName
    );
    if (type) {
      target.insertAfter(usingFor, type);
    } else {
      target.insertAtBeginning(usingFor);
    }
  }

  applyPendingFunctions(): void {
    this.helper.applyMutations();
    this.pendingFunctionSignatures.clear();
  }

  addImports(importSource: SourceUnit, symbolAliases: SymbolAlias[] = []): void {
    addImports(this.sourceUnit, importSource, symbolAliases);
  }

  addDependencyImports(
    functions: FunctionDefinition | StructDefinition | Array<FunctionDefinition | StructDefinition>
  ): void {
    addDependencyImports(this.sourceUnit, functions);
  }

  addFunctionImports(
    functions: FunctionDefinition | FunctionDefinition[],
    aliases?: string | string[]
  ): void {
    addFunctionImports(this.sourceUnit, functions, aliases);
  }

  getFilePath(fileName: string): string {
    if (this.outputPath && !path.isAbsolute(fileName)) {
      fileName = path.join(this.outputPath, fileName);
    }
    return fileName;
  }

  addSourceUnit(fileName: string, code?: string): SourceUnit {
    return this.helper.addSourceUnit(this.getFilePath(fileName), code);
  }

  getSolidityLibrary(name: keyof typeof SolidityLibraries & string): SourceUnit {
    const fileName = `${name}.sol`;
    let solidityLibrary = this.helper.sourceUnits.find(
      (s) => path.basename(s.absolutePath) === fileName && !s.absolutePath.startsWith(".")
    );
    if (!solidityLibrary) {
      solidityLibrary = this.helper.sourceUnits.find(
        (s) => path.basename(s.absolutePath) === fileName
      );
    }
    if (!solidityLibrary) {
      solidityLibrary = this.addSourceUnit(fileName, SolidityLibraries[name]);
    }
    return solidityLibrary;
  }

  getPointerLibraries(): SourceUnit {
    // @todo replace with getSolidityLibrary("PointerLibraries")
    let pointerLibraries = this.helper.sourceUnits.find(
      (s) =>
        path.basename(s.absolutePath) === "PointerLibraries.sol" && !s.absolutePath.startsWith(".")
    );
    if (!pointerLibraries) {
      pointerLibraries = this.helper.sourceUnits.find(
        (s) => path.basename(s.absolutePath) === "PointerLibraries.sol"
      );
    }
    if (!pointerLibraries) {
      pointerLibraries = this.addSourceUnit("PointerLibraries.sol", getPointerLibraries());
    }
    return pointerLibraries;
  }

  addPointerLibraries(): void {
    this.addImports(this.getPointerLibraries());
  }

  addSolidityLibrary(name: keyof typeof SolidityLibraries & string): void {
    this.addImports(this.getSolidityLibrary(name));
  }

  addEnum(
    name: string,
    members: string[],
    documentation?: string | StructuredDocumentation
  ): string {
    return addEnumDefinition(this.scope, name, members, documentation).name;
  }

  getConstant(
    name: string,
    value: number | string,
    kind: ConstantKind = ConstantKind.Uint,
    size = 256
  ): Identifier {
    return getConstant(this.scope, name, value, kind, size);
  }

  getNameGenConstant<K extends NameGenKey>(
    key: K,
    value: string | number,
    ...args: NameGenParameters<K>
  ): string {
    return this.addConstant((NameGen as NameGenTypeParams)[key](...args), value);
  }

  addConstant(
    name: string,
    value: number | string,
    kind: ConstantKind = ConstantKind.Uint,
    size = 256
  ): string {
    return this.getConstant(name, value, kind, size).name;
  }

  addFunction(
    name: string,
    code: StructuredText,
    applyImmediately?: boolean,
    cb?: (node: ASTNode) => void
  ): string {
    /* if (
      this.helper.mutationsCache.find(
        (c) =>
          c.kind !== "addSourceUnit" &&
          (c.referenceNode === this.scope || this.scope.children.includes(c.referenceNode) && c.)
      )
    ) {
      this.helper.addFunctionMutation(this.scope, writeNestedStructure(code), name)
    } */
    this.helper.addFunctionMutation(this.scope, writeNestedStructure(code), name, cb);
    if (applyImmediately) {
      this.applyPendingFunctions();
    }
    return name;
  }

  addInternalFunction(
    name: string,
    inputParameters: string,
    outputParameters: string | undefined,
    body: StructuredText,
    mutability: FunctionStateMutability = FunctionStateMutability.NonPayable,
    comment?: StructuredText,
    applyImmediately?: boolean,
    cb?: (node: ASTNode) => void
  ): string {
    const modifiers = [
      mutability === FunctionStateMutability.NonPayable
        ? ""
        : mutability === FunctionStateMutability.Constant
        ? "pure"
        : mutability
    ];

    if (this.scope instanceof ContractDefinition) {
      modifiers.unshift("internal");
    }
    if (outputParameters) {
      modifiers.push(`returns (${outputParameters})`);
    }
    if (modifiers.length > 0) {
      modifiers.push("");
    }
    const signature = `function ${name} (${inputParameters}) ${modifiers.join(" ")}`;
    if (this.pendingFunctionSignatures.has(signature)) {
      return name;
    }
    this.pendingFunctionSignatures.set(signature, true);
    const code = [signature, "{", body, "}"];
    if (comment) {
      code.unshift(comment);
    }
    return this.addFunction(name, code, applyImmediately, cb);
  }

  prependFunction(name: string, code: StructuredText, applyImmediately?: boolean): string {
    const firstChild =
      this.scope instanceof SourceUnit
        ? this.scope.children.find((c) => !isInstanceOf(c, PragmaDirective, ImportDirective))
        : this.scope.children.find(
            (c) =>
              !isInstanceOf(
                c,
                StructDefinition,
                UsingForDirective,
                UserDefinedValueTypeDefinition,
                EnumDefinition,
                VariableDeclaration
              )
          );
    if (!firstChild) {
      return this.addFunction(name, code, applyImmediately);
    }
    this.helper.addFunctionMutation(this.scope, writeNestedStructure(code), name, firstChild);
    if (applyImmediately) {
      this.applyPendingFunctions();
    }
    return name;
  }

  getYulConstant(name: string, value: number | string): YulIdentifier {
    return getYulConstant(this.scope, name, value);
  }

  hasFunction(name: string): boolean {
    return Boolean(findFunctionDefinition(this.scope, name));
  }
}

export class WrappedSourceUnit extends WrappedScope<SourceUnit> {
  constructor(helper: CompileHelper, scope: SourceUnit, outputPath?: string) {
    super(helper, scope, outputPath);
    SOURCE_UNIT_WRAPPERS.set(scope, this);
  }

  static getWrapper(
    helper: CompileHelper,
    sourceUnitOrName: SourceUnit | string,
    outputPath?: string
  ): WrappedSourceUnit {
    if (typeof sourceUnitOrName === "string") {
      if (outputPath && !path.isAbsolute(sourceUnitOrName)) {
        sourceUnitOrName = path.join(outputPath, sourceUnitOrName);
      }
    }
    const sourceUnit =
      sourceUnitOrName instanceof SourceUnit
        ? sourceUnitOrName
        : helper.getOrCreateSourceUnit(sourceUnitOrName);
    const wrapper = SOURCE_UNIT_WRAPPERS.get(sourceUnit);

    if (!wrapper) {
      return new WrappedSourceUnit(helper, sourceUnit, outputPath);
    }
    return wrapper;
  }

  addContract(
    name: string,
    kind: ContractKind,
    linearizedBaseContracts: number[] = []
  ): WrappedContract {
    return WrappedContract.getWrapper(
      this.helper,
      this.scope,
      name,
      kind,
      linearizedBaseContracts,
      this.outputPath
    );
  }
}

export class WrappedContract extends WrappedScope<ContractDefinition> {
  constructor(
    helper: CompileHelper,
    scope: ContractDefinition,
    public name: string,
    public kind: ContractKind,
    public linearizedBaseContracts: number[] = [],
    outputPath?: string
  ) {
    super(helper, scope, outputPath);
    CONTRACT_WRAPPERS.set(scope, this);
  }

  get parent(): WrappedSourceUnit {
    return WrappedSourceUnit.getWrapper(this.helper, this.sourceUnit);
  }

  static getWrapperFromContract(
    helper: CompileHelper,
    contract: ContractDefinition,
    outputPath?: string
  ): WrappedContract {
    if (CONTRACT_WRAPPERS.has(contract)) {
      return CONTRACT_WRAPPERS.get(contract)!;
    }
    return new WrappedContract(
      helper,
      contract,
      contract.name,
      contract.kind,
      contract.linearizedBaseContracts,
      outputPath
    );
  }

  static getWrapper(
    helper: CompileHelper,
    sourceUnit: SourceUnit,
    name: string,
    kind: ContractKind,
    linearizedBaseContracts: number[] = [],
    outputPath?: string
  ): WrappedContract {
    let contract: ContractDefinition | undefined = findContractDefinition(sourceUnit, name);
    if (contract === undefined) {
      contract = helper.factory.makeContractDefinition(
        name,
        sourceUnit.id,
        kind,
        false,
        true,
        linearizedBaseContracts,
        []
      );
      if (linearizedBaseContracts.length) {
        const context = contract.requiredContext;
        for (const id of linearizedBaseContracts) {
          contract.appendChild(
            helper.factory.makeInheritanceSpecifier(
              helper.factory.makeIdentifierPath(
                (context.locate(id) as ContractDefinition).name,
                id
              ),
              []
            )
          );
        }
      }
      sourceUnit.appendChild(contract);
    } else if (CONTRACT_WRAPPERS.has(contract)) {
      return CONTRACT_WRAPPERS.get(contract)!;
    }
    return new WrappedContract(helper, contract, name, kind, linearizedBaseContracts, outputPath);
  }
}
