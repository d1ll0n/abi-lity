/**
 * Solc-typed-ast helper library.
 *
 * Provides ~48 utility functions for querying, building, and manipulating
 * nodes in the solc-typed-ast tree. Covers import management, constant
 * declarations, function/contract lookup, override resolution, and
 * scope traversal.
 */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { flatten } from "lodash";
import {
  assert,
  ASTContext,
  ASTNode,
  ASTNodeFactory,
  ASTSearch,
  coerceArray,
  ContractDefinition,
  ContractKind,
  EnumDefinition,
  Expression,
  FunctionCall,
  FunctionCallKind,
  FunctionDefinition,
  FunctionKind,
  FunctionStateMutability,
  FunctionVisibility,
  Identifier,
  IdentifierPath,
  InferType,
  isInstanceOf,
  LatestCompilerVersion,
  MemberAccess,
  ParameterList,
  resolveAny,
  SourceUnit,
  StateVariableVisibility,
  staticNodeFactory,
  StructDefinition,
  StructuredDocumentation,
  SymbolAlias,
  TypeName,
  UserDefinedTypeName,
  UserDefinedValueTypeDefinition,
  UserDefinition,
  VariableDeclaration,
  VariableDeclarationStatement,
  YulIdentifier
} from "solc-typed-ast";
import { ABIEncoderVersion } from "solc-typed-ast/dist/types/abi";
import { EnumType, StructType } from "../ast";

import { getDirectory, getRelativePath } from "./files/path_utils";
import { ConstantKind, makeConstantDeclaration } from "./make_constant";

/** Extracts the referenced declaration ID from a SymbolAlias (import symbol). */
export const symbolAliasToId = (symbolAlias: SymbolAlias): number =>
  typeof symbolAlias.foreign === "number"
    ? symbolAlias.foreign
    : symbolAlias.foreign.referencedDeclaration ?? symbolAlias.foreign.id;

/** Walks up the AST to find the nearest SourceUnit ancestor. Throws if none exists. */
export const getParentSourceUnit = (node: ASTNode): SourceUnit => {
  if (node instanceof SourceUnit) return node;
  const sourceUnit = node.getClosestParentByTypeString("SourceUnit") as SourceUnit | undefined;
  if (!sourceUnit) {
    throw Error(`Could not find SourceUnit ancestor of provided ${node.type}`);
  }
  return sourceUnit;
};

/** Creates a FunctionCall AST node that calls `fn` with the given arguments. */
export function makeFunctionCallFor(
  fn: FunctionDefinition | Expression,
  args: Expression[]
): FunctionCall {
  const identifier =
    fn instanceof FunctionDefinition ? staticNodeFactory.makeIdentifierFor(fn) : fn;

  return staticNodeFactory.makeFunctionCall(
    fn.requiredContext,
    "",
    FunctionCallKind.FunctionCall,
    identifier,
    args
  );
}

/** Creates a VariableDeclarationStatement that captures the return values of a FunctionCall. */
export function makeVariableDeclarationStatementFromFunctionCall(
  factory: ASTNodeFactory,
  functionCall: FunctionCall
): VariableDeclarationStatement {
  const variableDeclarations = (
    functionCall.vReferencedDeclaration as FunctionDefinition
  )?.vReturnParameters.vParameters.map((param) => factory.copy(param));
  return factory.makeVariableDeclarationStatement(
    variableDeclarations.map((v) => v.id),
    variableDeclarations,
    functionCall
  );
}

/** Creates a type-conversion FunctionCall (e.g., `uint256(expr)`). */
export function makeElementaryTypeConversion(
  factory: ASTNodeFactory,
  elementaryType: string,
  expression: Expression
): FunctionCall {
  return factory.makeFunctionCall(
    elementaryType,
    FunctionCallKind.TypeConversion,
    factory.makeIdentifier(elementaryType, elementaryType, -1),
    [expression]
  );
}

/** Finds the EnumDefinition or StructDefinition node in the ASTContext matching `abiType.name`. */
export function locateDefinitionForType(
  ctx: ASTContext,
  abiType: StructType | EnumType
): EnumDefinition | StructDefinition {
  const definition = [...ctx.nodes].find(
    (ast) => isInstanceOf(ast, EnumDefinition, StructDefinition) && ast.name === abiType.name
  );
  if (!definition) {
    throw Error(`Could not locate definition for type ${abiType.name}`);
  }
  return definition as EnumDefinition | StructDefinition;
}

/** Creates a free (file-level) FunctionDefinition node scoped to the given SourceUnit. */
export function makeGlobalFunctionDefinition(
  sourceUnit: SourceUnit,
  name: string,
  parameters: ParameterList = staticNodeFactory.makeParameterList(sourceUnit.requiredContext, []),
  returnParameters: ParameterList = staticNodeFactory.makeParameterList(
    sourceUnit.requiredContext,
    []
  ),
  stateMutability = FunctionStateMutability.Pure,
  body = staticNodeFactory.makeBlock(sourceUnit.requiredContext, [])
): FunctionDefinition {
  return staticNodeFactory.makeFunctionDefinition(
    sourceUnit.requiredContext,
    sourceUnit.id,
    FunctionKind.Free,
    name,
    false,
    FunctionVisibility.Default,
    stateMutability,
    false,
    parameters,
    returnParameters,
    [],
    undefined,
    body
  );
}

/** Convenience wrapper around `staticNodeFactory.makeVariableDeclarationStatement`. */
export function makeVariableDeclarationStatement(
  variableDeclarations: VariableDeclaration | VariableDeclaration[],
  initialValue?: Expression
): VariableDeclarationStatement {
  variableDeclarations = coerceArray(variableDeclarations);
  return staticNodeFactory.makeVariableDeclarationStatement(
    variableDeclarations[0].requiredContext,
    variableDeclarations.map((v) => v.id),
    variableDeclarations,
    initialValue
  );
}

function getFunctionDefinitions(
  ctx: ContractDefinition | SourceUnit,
  name: string
): FunctionDefinition[] {
  const functions = ctx.getChildrenBySelector(
    (child) =>
      child instanceof FunctionDefinition &&
      (((child.kind === FunctionKind.Function || child.kind === FunctionKind.Free) &&
        child.name === name) ||
        (child.kind === FunctionKind.Constructor && name === "constructor") ||
        (child.kind === FunctionKind.Fallback && name === "fallback") ||
        (child.kind === FunctionKind.Receive && name === "receive"))
  ) as FunctionDefinition[];
  return functions;
}

/** Creates a payable external fallback function on a contract, with automatic override specifier. */
export function makeFallbackFunction(
  contract: ContractDefinition,
  virtual?: boolean
): FunctionDefinition {
  const ctx = contract.requiredContext;
  const fn = staticNodeFactory.makeFunctionDefinition(
    ctx,
    contract.id,
    FunctionKind.Fallback,
    `fallback`,
    virtual || false,
    FunctionVisibility.External,
    FunctionStateMutability.Payable,
    false,
    staticNodeFactory.makeParameterList(ctx, []),
    staticNodeFactory.makeParameterList(ctx, []),
    [],
    undefined,
    staticNodeFactory.makeBlock(ctx, [])
  );

  return inferOverrideSpecifier(fn);
}

/** Adds an override specifier to `fn` if it overrides functions in base contracts. */
export function inferOverrideSpecifier(fn: FunctionDefinition): FunctionDefinition {
  const ctx = fn.requiredContext;
  const overriddenFunctions = resolveOverriddenFunctions(fn);
  if (overriddenFunctions.length > 0) {
    const overrides =
      overriddenFunctions.length > 1
        ? overriddenFunctions.map((f) =>
            staticNodeFactory.makeUserDefinedTypeName(
              ctx,
              "",
              (f.vScope as ContractDefinition).name,
              f.id
            )
          )
        : [];
    fn.vOverrideSpecifier = staticNodeFactory.makeOverrideSpecifier(ctx, overrides);
  }
  return fn;
}

/** Finds a FunctionDefinition by name in a contract or source unit. Handles special function kinds. */
export function findFunctionDefinition(
  ctx: ContractDefinition | SourceUnit,
  name: string
): FunctionDefinition | undefined {
  return getFunctionDefinitions(ctx, name)[0];
}

function getContractDefinitions(ctx: SourceUnit, name: string): ContractDefinition[] {
  const contracts = ctx.getChildrenBySelector(
    (child) => child instanceof ContractDefinition && child.name === name
  ) as ContractDefinition[];
  return contracts;
}

/** Finds a ContractDefinition by name in a SourceUnit. */
export function findContractDefinition(
  ctx: SourceUnit,
  name: string
): ContractDefinition | undefined {
  return getContractDefinitions(ctx, name)[0];
}

/** Adds a ContractDefinition to a SourceUnit, or returns the existing one if same name exists. */
export function addUniqueContractDefinition(
  ctx: SourceUnit,
  node: ContractDefinition
): ContractDefinition {
  const existingContract = findContractDefinition(ctx, node.name);
  if (!existingContract) {
    return ctx.appendChild(node) as ContractDefinition;
  }
  return existingContract;
}

/** Creates and appends an EnumDefinition with the given member names. */
export function addEnumDefinition(
  ctx: SourceUnit | ContractDefinition,
  name: string,
  members: string[],
  documentation?: string | StructuredDocumentation
): EnumDefinition {
  const node = staticNodeFactory.makeEnumDefinition(
    ctx.requiredContext,
    name,
    members.map((m) => staticNodeFactory.makeEnumValue(ctx.requiredContext, m)),
    documentation
  );

  return ctx.appendChild(node) as EnumDefinition;
}

function getAllConstantDeclarations(node: ContractDefinition | SourceUnit): VariableDeclaration[] {
  return node.getChildrenBySelector(
    (child) => child instanceof VariableDeclaration && child.constant && child.parent === node
  );
}

/** Finds a constant VariableDeclaration by name in the node or its parent SourceUnit. */
export const findConstantDeclaration = (
  node: ContractDefinition | SourceUnit,
  name: string
): VariableDeclaration | undefined => {
  const sourceUnit = getParentSourceUnit(node);
  let declaration = getAllConstantDeclarations(node).filter((c) => c.name === name)[0];

  if (!declaration && node !== sourceUnit) {
    declaration = getAllConstantDeclarations(sourceUnit).filter((c) => c.name === name)[0];
  }
  return declaration;
};

/**
 * Creates a new constant VariableDeclaration in the SourceUnit containing
 * `node` if a constant variable declaration of the same name does not
 * already exist.
 */
export function addUniqueGlobalConstantDeclaration(
  node: ASTNode,
  name: string,
  value: string | number
): VariableDeclaration {
  const ctx = node.requiredContext;
  const sourceUnit = getParentSourceUnit(node);
  let existingConstant = findConstantDeclaration(sourceUnit, name);
  if (!existingConstant) {
    existingConstant = staticNodeFactory.makeConstantUint256(ctx, name, value, sourceUnit.id);
    sourceUnit.appendChild(existingConstant);
  }
  return existingConstant;
}

export function getRequiredContractDefinitionOrSourceUnit(
  node: ASTNode
): ContractDefinition | SourceUnit {
  if (isInstanceOf(node, SourceUnit, ContractDefinition)) {
    return node;
  }
  const parent = node.getClosestParentBySelector((p) =>
    isInstanceOf(p, SourceUnit, ContractDefinition)
  ) as ContractDefinition | SourceUnit;
  assert(
    parent !== undefined,
    `Node not a SourceUnit or ContractDefinition and has no parent that is`
  );
  return parent;
}

/**
 * Creates a constant VariableDeclaration in the nearest contract or source unit scope.
 * Supports uint, fixed bytes, and string constants. Inserts after existing constants
 * or at the beginning of the scope if none exist.
 */
export function addUniqueConstantDeclaration(
  node: ASTNode,
  name: string,
  value: string | number,
  kind: ConstantKind = ConstantKind.Uint,
  size = 256
): VariableDeclaration {
  const targetNode = getRequiredContractDefinitionOrSourceUnit(node);
  let existingConstant = findConstantDeclaration(targetNode, name);
  if (!existingConstant) {
    existingConstant = makeConstantDeclaration(
      node.requiredContext,
      name,
      kind,
      value,
      targetNode.id,
      size
    );

    existingConstant.stateVariable = true;
    const definedConstants = targetNode
      .getChildrenByType(VariableDeclaration)
      .filter((decl) => decl.parent === targetNode && decl.constant);
    if (definedConstants.length) {
      targetNode.insertAfter(existingConstant, definedConstants[definedConstants.length - 1]);
    } else {
      targetNode.insertAtBeginning(existingConstant);
    }
  }
  return existingConstant;
}

/** Appends a FunctionDefinition if no function with the same name exists in the scope. */
export function addUniqueFunctionDefinition(
  ctx: ContractDefinition | SourceUnit,
  node: FunctionDefinition
): FunctionDefinition {
  const existingFunction = findFunctionDefinition(ctx, node.name);
  if (!existingFunction) {
    return ctx.appendChild(node) as FunctionDefinition;
  }
  return existingFunction;
}

/** Adds a unique function definition and returns an Identifier referencing it. */
export function getUniqueFunctionDefinition(
  ctx: ContractDefinition | SourceUnit,
  node: FunctionDefinition
): Identifier {
  return staticNodeFactory.makeIdentifierFor(addUniqueFunctionDefinition(ctx, node));
}

/** Creates a unique constant and returns an Identifier referencing it. */
export function getConstant(
  node: ASTNode,
  name: string,
  value: string | number,
  kind: ConstantKind = ConstantKind.Uint,
  size = 256
): Identifier {
  return staticNodeFactory.makeIdentifierFor(
    addUniqueConstantDeclaration(node, name, value, kind, size)
  );
}

/** Creates a unique constant and returns a YulIdentifier referencing it (for inline assembly). */
export function getYulConstant(node: ASTNode, name: string, value: string | number): YulIdentifier {
  return staticNodeFactory.makeYulIdentifierFor(addUniqueConstantDeclaration(node, name, value));
}

/**
 * Updates the relative paths of import directives after the absolute path
 * for `sourceUnit` is modified.
 * Does not affect imports with non-relative paths.
 */
export function updateSourceUnitImports(sourceUnit: SourceUnit): void {
  const srcPath = getDirectory(sourceUnit.absolutePath);
  // sourceUnit.vImportDirectives.map(i => i.absolutePath)
  sourceUnit.vImportDirectives.forEach((directive) => {
    if (directive.file.startsWith("./") || directive.file.startsWith("../")) {
      const relativePath = getRelativePath(srcPath, directive.absolutePath);
      directive.file = relativePath;
    }
  });
}

/**
 * Add imports for `symbolAliases` in `importSource` to `sourceUnit`
 * if they are not already imported.
 */
export function addImports(
  sourceUnit: SourceUnit,
  importSource: SourceUnit,
  symbolAliases: SymbolAlias[]
): void {
  const { vImportDirectives } = sourceUnit;
  const directive = vImportDirectives.find(
    (_import) => _import.absolutePath === importSource.absolutePath
  );
  if (!directive) {
    const srcPath = getDirectory(sourceUnit.absolutePath);
    const directive = staticNodeFactory.makeImportDirective(
      sourceUnit.requiredContext,
      getRelativePath(srcPath, importSource.absolutePath),
      importSource.absolutePath,
      "",
      symbolAliases,
      sourceUnit.id,
      importSource.id
    );
    const pragmaDirectives = sourceUnit.getChildrenByTypeString("PragmaDirective");

    const pragma = pragmaDirectives[pragmaDirectives.length - 1];

    if (pragma) {
      sourceUnit.insertAfter(directive, pragma);
    } else {
      sourceUnit.insertAtBeginning(directive);
    }
  } else {
    for (const _symbol of symbolAliases) {
      if (!directive.symbolAliases.find((s) => symbolAliasToId(s) === symbolAliasToId(_symbol))) {
        directive.symbolAliases.push(_symbol);
      }
    }
  }
}

/** Adds an import for a user-defined type or function to `sourceUnit` if not already imported. */
export function addTypeImport(
  sourceUnit: SourceUnit,
  type: UserDefinedTypeName | UserDefinition | FunctionDefinition
): void {
  if (type instanceof UserDefinedTypeName) {
    type = type.vReferencedDeclaration as UserDefinition;
  }
  const parentSourceUnit = getParentSourceUnit(type);
  if (parentSourceUnit === sourceUnit) return;

  addImports(sourceUnit, parentSourceUnit, []);
}

/* function getDependencies(definitions: UserDefinition | UserDefinition[], inclusive = false) {
  definitions = coerceArray(definitions);
  const typeDependencies = flatten(
    definitions.map((def) => def.getChildrenByType(UserDefinedTypeName))
  );
  const dependencies = typeDependencies.map((t) => t.vReferencedDeclaration as UserDefinition);
  if (inclusive) {
    dependencies.push(...definitions);
  }
  return dependencies;
}

function importDependenciesAndReturnReferences(
  ctx: ContractDefinition | SourceUnit,
  definitions: UserDefinition | UserDefinition[]
) {

} */
/* 
function getRequiredImportsFor(
  callingContext: ContractDefinition | SourceUnit,
  fn: FunctionDefinition
) {
  if (fn.vScope.type === "SourceUnit") {
    const callingSourceUnit = getParentSourceUnit(callingContext);
    const fnSourceUnit = fn.vScope as SourceUnit;
    if (callingSourceUnit !== fnSourceUnit) {
    }
  }
} */

/** Adds import directives for all given user-defined type definitions to the source unit. */
export function addDefinitionImports(sourceUnit: SourceUnit, definitions: UserDefinition[]): void {
  const importsNeeded = definitions.reduce((importDirectives, type) => {
    const parent = getParentSourceUnit(type);
    if (parent === sourceUnit) return importDirectives;
    if (!type.vScope) {
      console.log(`No scope for type?`);
      console.log(type.print(1));
    }
    // If child scoped to file, import child directly.
    // If contract, import contract.
    const foreignSymbol = staticNodeFactory.makeIdentifierFor(
      type.vScope.type === "SourceUnit" ? type : (type.vScope as ContractDefinition)
    );
    const directives = importDirectives[parent.id] ?? (importDirectives[parent.id] = []);
    if (
      !directives.some(
        (f) =>
          (f.foreign as Identifier).referencedDeclaration === foreignSymbol.referencedDeclaration
      )
    ) {
      directives.push({
        foreign: foreignSymbol
      } as SymbolAlias);
    }
    return importDirectives;
  }, {} as Record<string, SymbolAlias[]>);
  const entries = Object.entries(importsNeeded);
  const ctx = sourceUnit.requiredContext;
  for (const [sourceId, symbolAliases] of entries) {
    const importSource = ctx.locate(+sourceId) as SourceUnit;
    console.log(`Adding import for ${importSource.absolutePath}`);
    console.log(
      symbolAliases
        .map((s) => (s.foreign instanceof Identifier ? s.foreign.name : s.foreign))
        .join(", ")
    );

    addImports(sourceUnit, importSource, symbolAliases);
  }
}

/** Finds all UserDefinedTypeName references within functions/structs and adds their imports. */
export function addDependencyImports(
  sourceUnit: SourceUnit,
  functions: FunctionDefinition | StructDefinition | Array<FunctionDefinition | StructDefinition>
  // inclusive = false
): void {
  functions = coerceArray(functions);
  const typeDependencies = flatten(
    functions.map((fn) => fn.getChildrenByType(UserDefinedTypeName))
  );
  // @todo why does this sometimes yield YulFunctionCall???
  const definitions = typeDependencies
    .map((t) => t.vReferencedDeclaration as UserDefinition)
    .filter((t) =>
      isInstanceOf(
        t,
        ContractDefinition,
        StructDefinition,
        EnumDefinition,
        UserDefinedValueTypeDefinition
      )
    );
  // if (inclusive) {
  //   definitions.push(
  //     ...(functions.filter((fn) => fn instanceof StructDefinition) as StructDefinition[])
  //   );
  // }
  addDefinitionImports(sourceUnit, definitions);
}

/** Adds import directives for the given functions (or their parent contracts/libraries) to a source unit. */
export function addFunctionImports(
  sourceUnit: SourceUnit,
  functions: FunctionDefinition | FunctionDefinition[],
  aliases?: string | string[]
): void {
  functions = coerceArray(functions);
  aliases = aliases && coerceArray(aliases);
  const importsNeeded = functions.reduce((importDirectives, fn, i) => {
    const parent = getParentSourceUnit(fn);
    if (parent === sourceUnit) return importDirectives;
    // Import function directly if it's a free function; otherwise import contract/library/interface
    const foreignSymbol = staticNodeFactory.makeIdentifierFor(
      fn.vScope.type === "SourceUnit" ? fn : (fn.vScope as ContractDefinition)
    );
    const directives = importDirectives[parent.id] ?? (importDirectives[parent.id] = []);
    if (
      !directives.some(
        (f) =>
          (f.foreign as Identifier).referencedDeclaration === foreignSymbol.referencedDeclaration
      )
    ) {
      const alias = aliases?.[i];
      directives.push({
        foreign: foreignSymbol,
        local: alias
      } as SymbolAlias);
    }
    return importDirectives;
  }, {} as Record<string, SymbolAlias[]>);
  const entries = Object.entries(importsNeeded);
  const ctx = sourceUnit.requiredContext;
  for (const [sourceId, symbolAliases] of entries) {
    const importSource = ctx.locate(+sourceId) as SourceUnit;
    console.log(`Adding import for ${importSource.absolutePath} to ${sourceUnit.absolutePath}`);
    console.log(
      symbolAliases
        .map((s) => (s.foreign instanceof Identifier ? s.foreign.name : s.foreign))
        .join(", ")
    );
    addImports(sourceUnit, importSource, symbolAliases);
  }
}

/**
 * Locate all type dependencies (StructType or EnumType) that are set as
 * referenced declarations in the parameters for `fn`, and add imports
 * for them to the parent SourceUnit for `fn` if they are in other files.
 * @param fn FunctionDefinition with dependencies to locate
 */
export function addRequiredImports(fn: FunctionDefinition): void {
  const sourceUnit = getParentSourceUnit(fn);
  const children = fn.getChildrenByType(UserDefinedTypeName);
  const importsNeeded = children.reduce((importDirectives, childType) => {
    const child = childType.vReferencedDeclaration as UserDefinition;
    if (child.vScope.id === fn.vScope.id) {
      return importDirectives;
    }
    const parent = fn.getClosestParentByType(SourceUnit);
    if (!parent) {
      throw Error(`Can not add imports for node without SourceUnit parent`);
    }
    if (!importDirectives[parent.id]) {
      importDirectives[parent.id] = [];
    }
    // If child scoped to file, import child directly.
    // If contract, import contract.
    const foreignSymbol = staticNodeFactory.makeIdentifierFor(
      child.vScope.type === "SourceUnit" ? child : (child.vScope as ContractDefinition)
    );
    if (child.vScope.type === "SourceUnit" && parent.absolutePath === sourceUnit.absolutePath) {
      return importDirectives;
    }
    importDirectives[parent.id].push({
      foreign: foreignSymbol
    } as SymbolAlias);
    return importDirectives;
  }, {} as Record<number, SymbolAlias[]>);
  const entries = Object.entries(importsNeeded);
  for (const [sourceId, symbolAliases] of entries) {
    const importSource = fn.requiredContext.locate(+sourceId) as SourceUnit;
    addImports(sourceUnit, importSource, symbolAliases);
  }
}

/** Builds a type string for a parameter list (e.g., `tuple(uint256,address)` with memory locations). */
export function getParametersTypeString(parameters: VariableDeclaration[]): string {
  const paramTypeStrings = parameters.map((v) => v.typeString);
  return (
    paramTypeStrings.length > 1 ? `tuple(${paramTypeStrings.join(",")})` : paramTypeStrings[0]
  )
    .replace(/(struct\s+)([\w\d]+)/g, "$1$2 memory")
    .replace(/\[\]/g, "[] memory");
}

/** Type guard: returns `true` if `fn` is a FunctionDefinition with external or public visibility. */
export function isExternalFunction(fn: ASTNode): fn is FunctionDefinition & boolean {
  return (
    fn instanceof FunctionDefinition &&
    fn.visibility !== undefined &&
    [FunctionVisibility.External, FunctionVisibility.Public].includes(fn.visibility)
  );
}

/** Recursively collects all ancestor contracts in the inheritance hierarchy. */
export function getParentsRecursive(
  contract: ContractDefinition,
  allowInterfaces?: boolean
): ContractDefinition[] {
  const parents = contract.vInheritanceSpecifiers
    .map((parent) => parent.vBaseType.vReferencedDeclaration as ContractDefinition)
    .filter(
      (parent: ContractDefinition) => allowInterfaces || parent.kind === ContractKind.Contract
    ) as ContractDefinition[];
  for (const parent of parents) {
    const _parents = getParentsRecursive(parent, allowInterfaces);
    _parents.forEach((ancestor) => {
      if (!parents.find((p) => p.name === ancestor.name)) {
        parents.push(ancestor);
      }
    });
  }
  return parents;
}

/** Returns all public state variables declared in a contract (including inherited). */
export function getPublicStateVariables(contract: ContractDefinition): VariableDeclaration[] {
  return ASTSearch.fromContract(contract).findStateVariablesByVisibility(
    StateVariableVisibility.Public
  );
}

/** Returns the function signature used for override matching (handles fallback/receive specially). */
export function getFunctionSignatureForOverride(fn: FunctionDefinition): string {
  if (fn.kind === FunctionKind.Fallback) {
    return "fallback";
  }
  if (fn.kind === FunctionKind.Receive) {
    return "receive";
  }
  const infer = new InferType(LatestCompilerVersion);
  return infer.signature(fn);
}

/** Finds all functions in base contracts that are overridden by the given function or state variable. */
export function resolveOverriddenFunctions(
  overriding: FunctionDefinition | VariableDeclaration
): FunctionDefinition[] {
  const infer = new InferType(LatestCompilerVersion);
  const contract = overriding.getClosestParentByType(ContractDefinition);
  assert(contract !== undefined, "Overriding function must be in a contract");
  const baseContracts = contract.vLinearizedBaseContracts.slice(1);
  const signature =
    overriding instanceof VariableDeclaration
      ? infer.signature(overriding)
      : getFunctionSignatureForOverride(overriding);

  const overridden: FunctionDefinition[] = [];
  for (const base of baseContracts) {
    for (const fn of base.vFunctions) {
      if (getFunctionSignatureForOverride(fn) === signature) {
        overridden.push(fn);
      }
    }
  }
  return overridden;
}

/** Generates a unique name within `scope` by prepending `prefix` until no name collision exists. */
export function getUniqueNameInScope(scope: ASTNode, name: string, prefix: string): string {
  while (resolveAny(name, scope, new InferType(LatestCompilerVersion), true, false).size > 0) {
    name = `${prefix}${name}`;
  }
  return name;
}

/** Traverses the import graph from `sourceUnit`, calling `cb` on each visited SourceUnit. */
export function walkImportedSourceUnits(
  sourceUnit: SourceUnit,
  cb: (sourceUnit: SourceUnit) => void,
  inclusive = false
): void {
  const visited = new Set<SourceUnit>();
  const walkSourceUnit = (sourceUnit: SourceUnit) => {
    if (visited.has(sourceUnit)) return;
    visited.add(sourceUnit);
    cb(sourceUnit);
    sourceUnit.vImportDirectives.forEach((importDirective) => {
      walkSourceUnit(importDirective.vSourceUnit);
    });
  };

  if (inclusive) {
    walkSourceUnit(sourceUnit);
  } else {
    visited.add(sourceUnit);
    sourceUnit.vImportDirectives.forEach((importDirective) =>
      walkSourceUnit(importDirective.vSourceUnit)
    );
  }
}

/**
 * Returns an Identifier or MemberAccess referencing a function in `source`, importing it
 * into `target` as needed. If the function is in a library, returns `Library.fnName`.
 */
export function getFunctionReference(
  target: SourceUnit,
  source: SourceUnit,
  fnName: string
): Identifier | MemberAccess {
  const fn = findFunctionDefinition(source, fnName);
  if (!fn) {
    throw Error(`${fnName} not found in ${source.absolutePath}`);
  }
  addTypeImport(target, fn);
  const library = fn.getClosestParentByType(ContractDefinition);
  if (library) {
    const ctx = target.requiredContext;
    return staticNodeFactory.makeMemberAccess(
      ctx,
      "",
      staticNodeFactory.makeIdentifierFor(library),
      fn.name,
      fn.id
    );
  } else {
    return staticNodeFactory.makeIdentifierFor(fn);
  }
}

/**
 * Finds all function definitions matching `functionName` that are available on `type`
 * via `using ... for` directives in the enclosing scope.
 */
export function getUsingForDirectiveFunctions(
  _node: ASTNode,
  type: TypeName,
  functionName: string
): FunctionDefinition[] {
  const containingContract = _node.getClosestParentByType(ContractDefinition);
  const sourceUnit = _node.getClosestParentByType(SourceUnit);
  const directives = [
    ...(sourceUnit?.vUsingForDirectives ?? []),
    ...(containingContract?.vUsingForDirectives ?? [])
  ];
  const typeString = type.typeString;
  const matchedFunctions: FunctionDefinition[] = [];
  for (const directive of directives) {
    let match = false;
    if (directive.vTypeName === undefined) {
      /// using for *;
      match = true;
    } else {
      match = directive.vTypeName.typeString === typeString;
    }
    if (!match) {
      continue;
    }

    if (directive.vFunctionList) {
      for (const funId of directive.vFunctionList) {
        if (funId instanceof IdentifierPath && funId.name === functionName) {
          const funDef = funId.vReferencedDeclaration;

          assert(
            funDef instanceof FunctionDefinition,
            "Unexpected non-function decl {0} for name {1} in using for {2}",
            funDef,
            funId.name,
            directive
          );

          matchedFunctions.push(funDef);
        }
      }
    }

    if (directive.vLibraryName) {
      const lib = directive.vLibraryName.vReferencedDeclaration;

      assert(
        lib instanceof ContractDefinition,
        "Unexpected non-library decl {0} for name {1} in using for {2}",
        lib,
        directive.vLibraryName.name,
        directive
      );

      matchedFunctions.push(...lib.vFunctions.filter((f) => f.name === functionName));
    }
  }
  return matchedFunctions.filter((fn) => {
    const param = fn.vParameters?.vParameters?.[0];
    const paramTypeString = param && (param.typeString || param.vType?.typeString);
    return paramTypeString === typeString;
  });
}
