import { flatten } from "lodash";
import {
  assert,
  ASTContext,
  ASTNode,
  ASTNodeFactory,
  coerceArray,
  ContractDefinition,
  DataLocation,
  EnumDefinition,
  Expression,
  FunctionCall,
  FunctionCallKind,
  FunctionDefinition,
  FunctionKind,
  FunctionStateMutability,
  FunctionVisibility,
  Identifier,
  isInstanceOf,
  Mutability,
  ParameterList,
  SourceUnit,
  StateVariableVisibility,
  staticNodeFactory,
  StructDefinition,
  SymbolAlias,
  UserDefinedTypeName,
  UserDefinition,
  VariableDeclaration,
  VariableDeclarationStatement,
  YulIdentifier
} from "solc-typed-ast";
import { EnumType, StructType } from "../ast";
import { getDirectory, getRelativePath } from "./path_utils";

export const symbolAliasToId = (symbolAlias: SymbolAlias): number =>
  typeof symbolAlias.foreign === "number"
    ? symbolAlias.foreign
    : symbolAlias.foreign.referencedDeclaration ?? symbolAlias.foreign.id;

export const getParentSourceUnit = (node: ASTNode): SourceUnit => {
  if (node instanceof SourceUnit) return node;
  const sourceUnit = node.getClosestParentByTypeString("SourceUnit") as SourceUnit | undefined;
  if (!sourceUnit) {
    throw Error(`Could not find SourceUnit ancestor of provided ${node.type}`);
  }
  return sourceUnit;
};

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
    (child) => child instanceof FunctionDefinition && child.name === name
  ) as FunctionDefinition[];
  return functions;
}

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

export function findContractDefinition(
  ctx: SourceUnit,
  name: string
): ContractDefinition | undefined {
  return getContractDefinitions(ctx, name)[0];
}

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

function getAllConstantDeclarations(node: ContractDefinition | SourceUnit): VariableDeclaration[] {
  return node.getChildrenBySelector(
    (child) => child instanceof VariableDeclaration && child.constant && child.parent === node
  );
}

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

export function addUniqueConstantDeclaration(
  node: ASTNode,
  name: string,
  value: string | number
): VariableDeclaration {
  const targetNode = getRequiredContractDefinitionOrSourceUnit(node);
  let existingConstant = findConstantDeclaration(targetNode, name);
  if (!existingConstant) {
    existingConstant = staticNodeFactory.makeConstantUint256(
      node.requiredContext,
      name,
      value,
      targetNode.id
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

export function getUniqueFunctionDefinition(
  ctx: ContractDefinition | SourceUnit,
  node: FunctionDefinition
): Identifier {
  return staticNodeFactory.makeIdentifierFor(addUniqueFunctionDefinition(ctx, node));
}

export function getConstant(node: ASTNode, name: string, value: string | number): Identifier {
  return staticNodeFactory.makeIdentifierFor(addUniqueConstantDeclaration(node, name, value));
}

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

export function addDefinitionImports(sourceUnit: SourceUnit, definitions: UserDefinition[]): void {
  const importsNeeded = definitions.reduce((importDirectives, type) => {
    const parent = getParentSourceUnit(type);
    if (parent === sourceUnit) return importDirectives;
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
    addImports(sourceUnit, importSource, symbolAliases);
  }
}

export function addDependencyImports(
  sourceUnit: SourceUnit,
  functions: FunctionDefinition | StructDefinition | Array<FunctionDefinition | StructDefinition>
): void {
  functions = coerceArray(functions);
  const typeDependencies = flatten(
    functions.map((fn) => fn.getChildrenByType(UserDefinedTypeName))
  );
  const definitions = typeDependencies.map((t) => t.vReferencedDeclaration as UserDefinition);
  addDefinitionImports(sourceUnit, definitions);
}

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

export function getParametersTypeString(parameters: VariableDeclaration[]): string {
  const paramTypeStrings = parameters.map((v) => v.typeString);
  return (
    paramTypeStrings.length > 1 ? `tuple(${paramTypeStrings.join(",")})` : paramTypeStrings[0]
  )
    .replace(/(struct\s+)([\w\d]+)/g, "$1$2 memory")
    .replace(/\[\]/g, "[] memory");
}
