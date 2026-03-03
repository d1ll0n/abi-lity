/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  ASTNode,
  ASTNodeFactory,
  ContractDefinition,
  ContractKind,
  ElementaryTypeName,
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

/** AST node types that can serve as a code generation scope. */
export type WrappableScope = ContractDefinition | SourceUnit;

/**
 * WeakMap cache ensuring a single WrappedSourceUnit per SourceUnit AST node.
 * Prevents duplicate wrappers and allows global lookup without traversal.
 */
export const SOURCE_UNIT_WRAPPERS = new WeakMap<ASTNode, WrappedSourceUnit>();

/**
 * WeakMap cache ensuring a single WrappedContract per ContractDefinition AST node.
 */
export const CONTRACT_WRAPPERS = new WeakMap<ASTNode, WrappedContract>();

/** Factory function that wraps a ContractDefinition or SourceUnit in the appropriate wrapper. */
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

/**
 * Abstract base for AST-based scope management in code generation.
 *
 * Wraps a `SourceUnit` or `ContractDefinition` AST node, providing methods for adding
 * functions, constants, imports, libraries, and custom types. Unlike `CodegenContext` (which
 * builds StructuredText strings), `WrappedScope` directly manipulates the solc-typed-ast AST
 * tree using `CompileHelper` mutations.
 *
 * Subclasses: `WrappedSourceUnit` (file-level scope), `WrappedContract` (contract-level scope).
 */
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

  /** Adds a `type <name> is uint256` user-defined value type to the scope or its source unit. */
  addValueTypeDefinition(
    name: string,
    limitedToScope?: boolean,
    baseTypeName?: ElementaryTypeName
  ): UserDefinedValueTypeDefinition {
    const target = limitedToScope ? this.scope : this.sourceUnit;
    const existing = target.vUserDefinedValueTypes.find((v) => v.name === name);
    if (existing) return existing;
    const type = this.factory.makeUserDefinedValueTypeDefinition(
      name,
      baseTypeName ?? this.factory.makeTypeNameUint256()
    );
    target.appendChild(type);

    return type;
  }

  /** Adds a `using ... for <type>` directive to attach library functions to a custom type. */
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

  /** Flushes all pending AST mutations (function additions) through CompileHelper. */
  applyPendingFunctions(): void {
    this.helper.applyMutations();
    this.pendingFunctionSignatures.clear();
  }

  /** Adds import directives from the given source unit into this scope's source unit. */
  addImports(importSource: SourceUnit, symbolAliases: SymbolAlias[] = []): void {
    addImports(this.sourceUnit, importSource, symbolAliases);
  }

  /** Adds import directives for all dependencies (struct types, etc.) of the given declarations. */
  addDependencyImports(
    functions: FunctionDefinition | StructDefinition | Array<FunctionDefinition | StructDefinition>
  ): void {
    addDependencyImports(this.sourceUnit, functions);
  }

  /** Adds import directives for the given functions, with optional aliases. */
  addFunctionImports(
    functions: FunctionDefinition | FunctionDefinition[],
    aliases?: string | string[]
  ): void {
    addFunctionImports(this.sourceUnit, functions, aliases);
  }

  /** Resolves a filename relative to the configured output path. */
  getFilePath(fileName: string): string {
    if (this.outputPath && !path.isAbsolute(fileName)) {
      fileName = path.join(this.outputPath, fileName);
    }
    return fileName;
  }

  /** Adds a new source unit (Solidity file) to the compilation context. */
  addSourceUnit(fileName: string, code?: string): SourceUnit {
    return this.helper.addSourceUnit(this.getFilePath(fileName), code);
  }

  /** Gets or creates a bundled Solidity library source unit (e.g. ForgeTestShim, JsonLib). */
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

  /**
   * Gets or creates the PointerLibraries.sol source unit, which provides typed
   * pointer helpers (CalldataPointer, MemoryPointer, etc.) used throughout generated code.
   */
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

  /** Imports the pointer libraries into this scope's source unit. */
  addPointerLibraries(): void {
    this.addImports(this.getPointerLibraries());
  }

  /** Imports a bundled Solidity library into this scope's source unit. */
  addSolidityLibrary(name: keyof typeof SolidityLibraries & string): void {
    this.addImports(this.getSolidityLibrary(name));
  }

  /** Adds an enum definition to this scope. */
  addEnum(
    name: string,
    members: string[],
    documentation?: string | StructuredDocumentation
  ): string {
    return addEnumDefinition(this.scope, name, members, documentation).name;
  }

  /** Gets or creates a constant and returns its Identifier AST node. */
  getConstant(
    name: string,
    value: number | string,
    kind: ConstantKind = ConstantKind.Uint,
    size = 256
  ): Identifier {
    return getConstant(this.scope, name, value, kind, size);
  }

  /** Creates a constant using a NameGen key for consistent naming. */
  getNameGenConstant<K extends NameGenKey>(
    key: K,
    value: string | number,
    ...args: NameGenParameters<K>
  ): string {
    return this.addConstant((NameGen as NameGenTypeParams)[key](...args), value);
  }

  /** Gets or creates a constant and returns its name string. */
  addConstant(
    name: string,
    value: number | string,
    kind: ConstantKind = ConstantKind.Uint,
    size = 256
  ): string {
    return this.getConstant(name, value, kind, size).name;
  }

  /**
   * Adds a function to this scope via CompileHelper mutation.
   * The code is parsed and the resulting AST node is appended to the scope.
   */
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

  /**
   * Adds an internal function with explicit parameter/return signatures and mutability.
   * Deduplicates by signature to prevent adding the same function twice.
   */
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

    // Don't add internal text if function is added at file level
    if (this.scope instanceof ContractDefinition) {
      modifiers.unshift("internal");
    }
    if (outputParameters) {
      modifiers.push(`returns (${outputParameters})`);
    }
    // If there are any modifiers, add a space between the last one and
    // the return parameters / opening bracket
    if (modifiers.length > 0) modifiers.push("");
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

  /** Like addFunction, but inserts before the first non-declaration child (before other functions). */
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

  /** Gets or creates a Yul-level constant for use in inline assembly blocks. */
  getYulConstant(name: string, value: number | string): YulIdentifier {
    return getYulConstant(this.scope, name, value);
  }

  /** Checks if a function with the given name already exists in this scope. */
  hasFunction(name: string): boolean {
    return Boolean(findFunctionDefinition(this.scope, name));
  }
}

/**
 * Source-file-level scope wrapper.
 *
 * Wraps a `SourceUnit` AST node for adding file-level free functions, constants,
 * and imports. Also serves as a factory for `WrappedContract` instances.
 * Cached via `SOURCE_UNIT_WRAPPERS` WeakMap for singleton access.
 */
export class WrappedSourceUnit extends WrappedScope<SourceUnit> {
  constructor(helper: CompileHelper, scope: SourceUnit, outputPath?: string) {
    super(helper, scope, outputPath);
    SOURCE_UNIT_WRAPPERS.set(scope, this);
  }

  /** Gets or creates a WrappedSourceUnit from a SourceUnit AST node or filename. */
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

  /** Creates or retrieves a WrappedContract within this source unit. */
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

/**
 * Contract-level scope wrapper.
 *
 * Wraps a `ContractDefinition` AST node for adding contract-level functions,
 * constants, and inheritance. Cached via `CONTRACT_WRAPPERS` WeakMap.
 */
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

  /** Gets or creates a WrappedContract from an existing ContractDefinition AST node. */
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

  /** Gets or creates a WrappedContract by name, creating the ContractDefinition if needed. */
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
        [],
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
