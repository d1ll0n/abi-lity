import {
  ASTNode,
  ASTNodeFactory,
  ASTWriter,
  DataLocation,
  DefaultASTWriterMapping,
  FunctionDefinition,
  FunctionVisibility,
  LatestCompilerVersion,
  pp,
  PrettyFormatter,
  SourceUnit,
  VariableDeclaration
} from "solc-typed-ast";
import { FunctionType, TypeNode } from "../../ast";
import { functionDefinitionToTypeNode } from "../../readers";
import { addTypeImport, makeFunctionCallFor } from "../../utils";
import NameGen from "../names";
import { dependsOnCalldataLocation, getPointerOffsetExpression } from "../utils";

export const isExternalFunction = (fn: FunctionDefinition | FunctionType): boolean =>
  fn.visibility !== undefined &&
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

  const decodeFunctionName = NameGen.abiDecode(parameterType);
  const typecastFunctionName = NameGen.typeCast(parameterType);
  const decodeFunction = findFunctionDefinition(decoderSourceUnit, decodeFunctionName);
  const typeCastFunction = findFunctionDefinition(decoderSourceUnit, typecastFunctionName);
  addTypeImport(sourceUnit, decodeFunction);
  addTypeImport(sourceUnit, typeCastFunction);

  const cdStart = factory.makeIdentifier("CalldataPointer", "CalldataStart", -1);
  const cdPtr = getPointerOffsetExpression(factory, cdStart, parameterType, DataLocation.CallData);
  const functionCall = makeFunctionCallFor(
    makeFunctionCallFor(typeCastFunction, [factory.makeIdentifierFor(decodeFunction)]),
    [cdPtr]
  );
  const variableDeclaration = factory.copy(parameter);
  variableDeclaration.storageLocation = DataLocation.Memory;
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
    if (dependsOnCalldataLocation(fn)) {
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
