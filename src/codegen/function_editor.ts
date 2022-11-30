import {
  ASTNode,
  ASTNodeFactory,
  ASTWriter,
  DataLocation,
  DefaultASTWriterMapping,
  Expression,
  FunctionCall,
  FunctionCallKind,
  FunctionDefinition,
  FunctionVisibility,
  Identifier,
  LatestCompilerVersion,
  pp,
  PrettyFormatter,
  replaceNode,
  Return,
  SourceUnit,
  VariableDeclaration
} from "solc-typed-ast";
import { TypeNode } from "../ast";
import { functionDefinitionToTypeNode } from "../readers";
import { addDependencyImports, addTypeImport, CompileHelper, makeFunctionCallFor } from "../utils";
import { abiDecodingFunction } from "./abi_decode";
import { getTypeCastFunctionName, typeCastAbiDecodingFunction } from "./type_cast";
import { CodegenContext, getPointerOffsetExpression } from "./utils";

export const isExternalFunction = (fn: FunctionDefinition): boolean =>
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

export function buildDecoderFile(helper: CompileHelper, primaryFileName: string): CodegenContext {
  const ctx = new CodegenContext(helper, primaryFileName.replace(".sol", "Decoder.sol"));
  const sourceUnit = helper.getSourceUnit(primaryFileName);
  const functions = getExternalFunctionsWithReferenceTypeParameters(
    sourceUnit.getChildrenByType(FunctionDefinition)
  );
  const typeNodes = getUniqueReferenceTypeParametersAndAddImports(ctx.decoderSourceUnit, functions);
  typeNodes.map((type) => abiDecodingFunction(ctx, type));
  const functionTypes = functions.map(functionDefinitionToTypeNode);
  for (const fn of functionTypes) {
    if (fn.parameters) {
      for (const member of fn.parameters.vMembers) {
        typeCastAbiDecodingFunction(ctx, member);
      }
      // typeCastAbiDecodingFunction(ctx, fn.parameters);
    }
  }
  return ctx;
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
    const writer = new ASTWriter(
      DefaultASTWriterMapping,
      new PrettyFormatter(2),
      LatestCompilerVersion
    );
    console.log(writer.write(node));
    throw Error(`${name} not found in ${pp(node)}`);
  }
  return functionDefinition;
}

/**
 * Inserts a VariableDeclarationStatement node at the beginning of the body
 * of `fn` which assigns the variable for `parameter` to a `FunctionCall` node
 * for the associated decoding function in `decoderSourceUnit`.
 */
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
  const typecastFunctionName = getTypeCastFunctionName(parameterType);
  const decodeFunction = findFunctionDefinition(decoderSourceUnit, decodeFunctionName);
  const typeCastFunction = findFunctionDefinition(decoderSourceUnit, typecastFunctionName);
  addTypeImport(sourceUnit, decodeFunction);
  addTypeImport(sourceUnit, typeCastFunction);

  /*   const offsetLiteral = staticNodeFactory.makeLiteralUint256(
    sourceUnit.requiredContext,
    toHex(parameterType.calldataHeadOffset + 4)
  ); */
  const cdStart = factory.makeIdentifier("CalldataPointer", "CalldataStart", -1);
  const cdPtr = getPointerOffsetExpression(factory, cdStart, parameterType, DataLocation.CallData);
  const functionCall = makeFunctionCallFor(
    makeFunctionCallFor(typeCastFunction, [factory.makeIdentifierFor(decodeFunction)]),
    [cdPtr]
  );
  const variableDeclaration = factory.copy(parameter);
  variableDeclaration.storageLocation =
    DataLocation.Memory; /* decodeFunction.vReturnParameters.vParameters.map((param) =>
    factory.copy(param)
  ); */
  const statement = factory.makeVariableDeclarationStatement(
    [variableDeclaration].map((v) => v.id),
    [variableDeclaration],
    functionCall
  );
  // const statement = makeVariableDeclarationStatementFromFunctionCall(factory, functionCall);
  statement.vDeclarations[0].name = parameter.name;
  parameter.name = "";
  fn.vBody.insertAtBeginning(statement);
}

/**
 * Removes the names of all reference-type parameters in external functions
 * inside of `sourceUnit`, moves their declarations to the function body and
 * assigns them using their associated decoding functions in `decoderSourceUnit`.
 */
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
    const internalCalls = fn.getChildrenByType(FunctionCall);
    if (
      internalCalls.some((call) =>
        (call.vReferencedDeclaration as FunctionDefinition)?.vParameters?.vParameters.some(
          (arg) => arg.storageLocation === DataLocation.CallData
        )
      )
    ) {
      continue;
    }
    fn.documentation = undefined;
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

export function replaceReturnStatementsWithCall(
  fn: FunctionDefinition,
  returnFn: FunctionDefinition
): void {
  const { vBody, vReturnParameters } = fn;
  if (!vReturnParameters.children.length) return;

  const factory = new ASTNodeFactory(fn.requiredContext);

  const returnStatements = fn.getChildrenByType(Return, true);

  const paramTypeStrings = vReturnParameters.vParameters.map(
    (v: VariableDeclaration) => v.typeString
  );
  const returnTypeString = (
    paramTypeStrings.length > 1 ? `tuple(${paramTypeStrings.join(",")})` : paramTypeStrings[0]
  )
    .replace(/(struct\s+)([\w\d]+)/g, "$1$2 memory")
    .replace(/\[\]/g, "[] memory");

  const returnFnIdentifier = factory.makeIdentifierFor(returnFn);

  for (const returnStatement of returnStatements) {
    const _call = factory.makeFunctionCall(
      returnTypeString,
      FunctionCallKind.FunctionCall,
      returnFnIdentifier,
      returnStatement.children as Expression[]
    );

    const callExpression = factory.makeExpressionStatement(_call);
    replaceNode(returnStatement, callExpression);
  }

  while (vReturnParameters.children.length > 0) {
    const parameter = vReturnParameters.children[0] as VariableDeclaration;
    // Define return params at start of body
    if (parameter.name) {
      if (fn.getChildrenByType(Identifier).find((node) => node.name === parameter.name)) {
        const copy = factory.copy(parameter);
        const statement = factory.makeVariableDeclarationStatement([copy.id], [copy]);
        vBody?.insertAtBeginning(statement);
      }
    }
    // Remove return parameter
    vReturnParameters.removeChild(parameter);
  }
}

// function getInternalDecodeFunctionCall(ctx: CodegenContext, type: TypeNode) {
//   const typeName = type.identifier;
//   const fnName = `abi_decode_${typeName}`;

//   const headPositionSrc = type.isDynamicallyEncoded
//     ? `add(4, calldataload(calldataPointer))`
//     : `calldataPointer`;

//   const outputType = type.writeParameter(DataLocation.Memory, "ret");
//   const decodeFn = abiDecodingFunction(ctx, type);
//   // const asmFunctions = [...ctx.functions.values()];
//   const code = writeNestedStructure([
//     `function ${fnName}(CalldataPointer cdPtr) pure returns (MemoryPointer mPtr) {`,
//     // [`assembly {`, [...asmFunctions, `ret := ${decodeFn}(${headPositionSrc})`], `}`],
//     `}`
//   ]);
//   return { code, name: fnName };
// }

// function addConstantsToSource(sourceUnit: SourceUnit, ctx: CodegenContext) {
//   for (const constantName of [...ctx.constants.keys()]) {
//     getConstant(
//       sourceUnit,
//       constantName,
//       ctx.constants
//         .get(constantName)
//         ?.replace(`uint256 constant ${constantName} = `, "")
//         .replace(";", "") as string
//     );
//   }
// }
