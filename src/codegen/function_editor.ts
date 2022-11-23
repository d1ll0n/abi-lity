import path from "path";
import {
  ASTNode,
  ASTNodeFactory,
  ASTWriter,
  DataLocation,
  DefaultASTWriterMapping,
  FunctionDefinition,
  FunctionVisibility,
  LatestCompilerVersion,
  PrettyFormatter,
  SourceUnit,
  staticNodeFactory,
  VariableDeclaration
} from "solc-typed-ast";
import { TupleType, TypeNode } from "../ast";
import { functionDefinitionToTypeNode } from "../readers";
import {
  addDependencyImports,
  addTypeImport,
  getConstant,
  makeFunctionCallFor,
  makeVariableDeclarationStatementFromFunctionCall,
  StructuredText,
  toHex,
  writeNestedStructure
} from "../utils";
import { abiDecodingFunction } from "./abi_decode";
import { DecoderContext } from "./utils";

const isExternalFunction = (fn: FunctionDefinition) =>
  [FunctionVisibility.External, FunctionVisibility.Public].includes(fn.visibility);

/**
 * Filters an array of FunctionDefinition nodes to only those with external or
 * public visibility and at least one reference type input parameter.
 */
export function getExternalFunctionsWithReferenceTypeParameters(
  functions: FunctionDefinition[]
): FunctionDefinition[] {
  return functions.filter(isExternalFunction).filter((fn) => {
    const type = functionDefinitionToTypeNode(fn);
    return type.parameters?.vMembers.some((m) => m.isReferenceType);
  });
}

/**
 * Given a list of externally visible functions with at least one reference type
 * parameter and a SourceUnit with decoders for all reference types in any of those
 * functions' parameters, returns the list of all unique reference type nodes and
 * adds imports for their decoding functions.
 */
function getUniqueReferenceTypeParametersAndAddImports(
  decoderSourceUnit: SourceUnit,
  functions: FunctionDefinition[]
): TypeNode[] {
  const typeMap = new Map<string, TypeNode>();
  for (const fn of functions.filter(isExternalFunction)) {
    const type = functionDefinitionToTypeNode(fn);
    addDependencyImports(decoderSourceUnit, fn);
    for (const param of type.parameters?.vMembers || []) {
      if (param.isValueType) continue;
      if (typeMap.has(param.identifier)) continue;
      typeMap.set(param.identifier, param);
    }
  }
  return [...typeMap.values()];
}

export function buildDecoderFile(sourceUnit: SourceUnit): string {
  const functions = getExternalFunctionsWithReferenceTypeParameters(
    sourceUnit.getChildrenByType(FunctionDefinition)
  );
  const absolutePath = sourceUnit.absolutePath.replace(
    path.parse(sourceUnit.absolutePath).base,
    "Decoder.sol"
  );
  const newSource = staticNodeFactory.makeSourceUnit(
    sourceUnit.requiredContext,
    "Decoder.sol",
    1,
    absolutePath,
    new Map()
  );
  const typeNodes = getUniqueReferenceTypeParametersAndAddImports(newSource, functions);
  const decodeFunctions = typeNodes.map((type) => getInternalDecodeFunction(type, newSource).code);

  const writer = new ASTWriter(
    DefaultASTWriterMapping,
    new PrettyFormatter(2),
    LatestCompilerVersion
  );
  const code = writeNestedStructure([writer.write(newSource), ...decodeFunctions]);
  return code;
}

function getParametersAndTypes(fn: FunctionDefinition): [VariableDeclaration[], TypeNode[]] {
  const parameters = fn.vParameters.vParameters;
  const fnType = functionDefinitionToTypeNode(fn);
  const parameterTypes = fnType.parameters?.vMembers;
  if (!parameters || !parameterTypes) throw Error(`Function ${fn.name} has no parameters`);
  return [parameters, parameterTypes];
}

function findFunctionDefinition(node: ASTNode, name: string): FunctionDefinition {
  const functionDefinition = node
    .getChildrenByType(FunctionDefinition)
    .find((fn) => fn.name === name);
  if (!functionDefinition) {
    throw Error(`${name} not found in ${node.print(2)}`);
  }
  return functionDefinition;
}

function makeParameterAssignmentFromDecodeFunctionCall(
  factory: ASTNodeFactory,
  sourceUnit: SourceUnit,
  decoderSourceUnit: SourceUnit,
  fn: FunctionDefinition,
  parameter: VariableDeclaration,
  parameterType: TypeNode
) {
  if (!(parameterType.isReferenceType && fn.vBody && parameter.name)) return;

  if (parameter.storageLocation === DataLocation.Memory) {
    parameter.storageLocation = DataLocation.CallData;
  }

  const decodeFunctionName = `abi_decode_${parameterType.identifier}`;
  const decodeFunction = findFunctionDefinition(decoderSourceUnit, decodeFunctionName);
  addTypeImport(sourceUnit, decodeFunction);

  const offsetLiteral = staticNodeFactory.makeLiteralUint256(
    sourceUnit.requiredContext,
    toHex(parameterType.calldataHeadOffset + 4)
  );
  const functionCall = makeFunctionCallFor(decodeFunction, [offsetLiteral]);
  const statement = makeVariableDeclarationStatementFromFunctionCall(factory, functionCall);
  statement.vDeclarations[0].name = parameter.name;
  parameter.name = "";
  fn.vBody.insertAtBeginning(statement);
}

export function replaceExternalFunctionReferenceTypeParameters(
  sourceUnit: SourceUnit,
  decoderSourceUnit: SourceUnit
): void {
  const functions = getExternalFunctionsWithReferenceTypeParameters(
    sourceUnit.getChildrenByType(FunctionDefinition)
  );
  const context = sourceUnit.requiredContext;
  const factory = new ASTNodeFactory(context);
  for (const fn of functions) {
    const [parameters, parameterTypes] = getParametersAndTypes(fn);
    for (let i = 0; i < parameters.length; i++) {
      makeParameterAssignmentFromDecodeFunctionCall(
        factory,
        sourceUnit,
        decoderSourceUnit,
        fn,
        parameters[i],
        parameterTypes[i]
      );
    }
  }
}

function getInternalDecodeFunction(type: TypeNode, sourceUnit: SourceUnit) {
  const typeName = type.identifier;
  const fnName = `abi_decode_${typeName}`;

  const ctx = new DecoderContext();
  const headPositionSrc = type.isDynamicallyEncoded
    ? `add(4, calldataload(calldataPointer))`
    : `calldataPointer`;

  const outputType = type.writeParameter(DataLocation.Memory, "ret");
  const decodeFn = abiDecodingFunction(ctx, type);
  const asmFunctions = [...ctx.functions.values()];
  const code = writeNestedStructure([
    `function ${fnName}(uint256 calldataPointer) pure returns (${outputType}) {`,
    [`assembly {`, [...asmFunctions, `ret := ${decodeFn}(${headPositionSrc})`], `}`],
    `}`
  ]);
  addConstantsToSource(sourceUnit, ctx);
  return { code, name: fnName };
}

function addConstantsToSource(sourceUnit: SourceUnit, ctx: DecoderContext) {
  for (const constantName of [...ctx.constants.keys()]) {
    getConstant(
      sourceUnit,
      constantName,
      ctx.constants
        .get(constantName)
        ?.replace(`uint256 constant ${constantName} = `, "")
        .replace(";", "") as string
    );
  }
}

function getDecodeParametersTuple(ctx: DecoderContext, type: TupleType) {
  const typeName = type.vMembers.length > 1 ? type.identifier : type.vMembers[0].identifier;
  const fnName = `abi_decode_${typeName}`;
  if (ctx.hasFunction(fnName)) {
    return { name: fnName, code: ctx.functions.get(fnName) as string };
  }
  const inner: StructuredText = [];
  for (const member of type.vMembers) {
    const headPositionSrc = 4 + type.calldataOffsetOfChild(member);
    const name = member.labelFromParent;
    if (!name) throw Error(`Tuple member not named: ${type.identifier} -> ${member.identifier}`);
    const decodeFn = member.isValueType ? `calldataload` : abiDecodingFunction(ctx, member);
    inner.push(`${name} := ${decodeFn}(${headPositionSrc})`);
  }
  const asmFunctions = [...ctx.functions.values()];

  const code = writeNestedStructure([
    `function ${fnName}() pure returns ${type.writeParameter(DataLocation.Memory)} {`,
    [`assembly {`, [...asmFunctions, inner], `}`],
    `}`
  ]);
  return { code, name: fnName };
}
