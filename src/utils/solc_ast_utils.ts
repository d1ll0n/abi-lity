import path from "path";
import {
  ASTContext,
  ASTNode,
  ASTNodeFactory,
  ContractDefinition,
  EnumDefinition,
  Expression,
  FunctionCall,
  FunctionCallKind,
  FunctionDefinition,
  Identifier,
  isInstanceOf,
  SourceUnit,
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

export function getCommonBasePath(sourceUnits: SourceUnit[]): string {
  const paths = sourceUnits.map((s) => path.parse(s.absolutePath).dir);
  paths.sort((a, b) => a.length - b.length);
  const length = paths[0].length;
  paths.forEach((p, i) => {
    paths[i] = p.slice(0, length);
  });
  if (!paths.every((p) => p === paths[0])) {
    throw Error(`Common base path not found for source units`);
  }
  return paths[0];
}

export const symbolAliasToId = (symbolAlias: SymbolAlias): number =>
  typeof symbolAlias.foreign === "number" ? symbolAlias.foreign : symbolAlias.foreign.id;

export const getParentSourceUnit = (node: ASTNode): SourceUnit => {
  if (node instanceof SourceUnit) return node;
  const sourceUnit = node.getClosestParentByTypeString("SourceUnit") as SourceUnit | undefined;
  if (!sourceUnit) {
    throw Error(`Could not find SourceUnit ancestor of provided ${node.type}`);
  }
  return sourceUnit;
};

export function makeFunctionCallFor(fn: FunctionDefinition, args: Expression[]): FunctionCall {
  const {
    vParameters: { vParameters }
  } = fn;

  const paramTypeStrings = vParameters.map((v) => v.typeString);

  const functionTypeString = (
    paramTypeStrings.length > 1 ? `tuple(${paramTypeStrings.join(",")})` : paramTypeStrings[0]
  )
    .replace(/(struct\s+)([\w\d]+)/g, "$1$2 memory")
    .replace(/\[\]/g, "[] memory");

  const identifier = staticNodeFactory.makeIdentifierFor(fn);

  return staticNodeFactory.makeFunctionCall(
    fn.requiredContext,
    functionTypeString,
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

export const findConstantDeclaration = (
  node: ASTNode,
  name: string
): VariableDeclaration | undefined => {
  const sourceUnit = getParentSourceUnit(node);
  return sourceUnit.getChildrenBySelector(
    (child) => child instanceof VariableDeclaration && child.name === name && child.constant
  )[0] as VariableDeclaration | undefined;
};

function getConstantDeclaration(
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

export function getConstant(node: ASTNode, name: string, value: string | number): Identifier {
  return staticNodeFactory.makeIdentifierFor(getConstantDeclaration(node, name, value));
}

export function getYulConstant(node: ASTNode, name: string, value: string | number): YulIdentifier {
  return staticNodeFactory.makeYulIdentifierFor(getConstantDeclaration(node, name, value));
}

export function getGlobalFunctionDefinitions(
  sourceUnit: SourceUnit,
  name: string
): FunctionDefinition | undefined {
  const functions = sourceUnit.getChildrenBySelector(
    (child) =>
      child instanceof FunctionDefinition && child.parent === sourceUnit && child.name === name
  ) as FunctionDefinition[];
  return functions[0];
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

  // If child scoped to file, import child directly.
  // If contract, import contract.
  const foreignSymbol = staticNodeFactory.makeIdentifierFor(
    type.vScope.type === "SourceUnit" ? type : (type.vScope as ContractDefinition)
  );
  addImports(sourceUnit, parentSourceUnit, [{ foreign: foreignSymbol } as SymbolAlias]);
}

export function addDependencyImports(sourceUnit: SourceUnit, fn: FunctionDefinition): void {
  const typeDependencies = fn.getChildrenByType(UserDefinedTypeName);
  const importsNeeded = typeDependencies.reduce((importDirectives, typeName) => {
    const type = typeName.vReferencedDeclaration as UserDefinition;
    const parent = getParentSourceUnit(type);
    if (parent === sourceUnit) return importDirectives;
    const foreignSymbol = staticNodeFactory.makeIdentifierFor(
      type.vScope.type === "SourceUnit" ? type : (type.vScope as ContractDefinition)
    );
    if (!importDirectives[parent.id]) {
      importDirectives[parent.id] = [];
    }
    importDirectives[parent.id].push({
      foreign: foreignSymbol
    } as SymbolAlias);
    return importDirectives;
  }, {} as Record<string, SymbolAlias[]>);
  const entries = Object.entries(importsNeeded);
  for (const [sourceId, symbolAliases] of entries) {
    const importSource = fn.requiredContext.locate(+sourceId) as SourceUnit;
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

const getDirectory = (_path: string): string =>
  !path.parse(_path).ext ? _path : path.parse(_path).dir;

const getRelativePath = (from: string, to: string): string => {
  let relative = path.relative(from, to);
  if (!relative.startsWith("../")) relative = `./${relative}`;
  return relative;
};
