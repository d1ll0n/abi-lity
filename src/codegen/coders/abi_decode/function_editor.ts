import {
  ASTNode,
  ASTNodeFactory,
  ContractDefinition,
  DataLocation,
  Expression,
  FunctionDefinition,
  FunctionVisibility,
  pp,
  SourceUnit,
  UsingForDirective,
  VariableDeclaration
} from "solc-typed-ast";
import { FunctionType, TypeNode } from "../../../ast";
import { functionDefinitionToTypeNode } from "../../../readers";
import { addTypeImport, getFunctionReference, makeFunctionCallFor } from "../../../utils";
import NameGen from "../../names";
import { dependsOnCalldataLocation, getPointerOffsetExpression } from "../../utils";

export const isExternalFunctionDefinitionOrType = (
  fn: FunctionDefinition | FunctionType
): boolean =>
  fn.visibility !== undefined &&
  [FunctionVisibility.External, FunctionVisibility.Public].includes(fn.visibility);

/**
 * Filters an array of FunctionDefinition nodes to only those with external or
 * public visibility and at least one reference type input parameter.
 */
export function getExternalFunctionsWithReferenceTypeParameters(
  functions: FunctionDefinition[]
): FunctionDefinition[] {
  return functions.filter(isExternalFunctionDefinitionOrType).filter((fn) => {
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
    throw Error(`${name} not found in ${pp(node)}`);
  }
  return functionDefinition;
}

function getFunctionTypeCastCall(
  factory: ASTNodeFactory,
  node: ASTNode,
  typeCastFunction: FunctionDefinition,
  fnReference: Expression
) {
  const typeCastLibrary = typeCastFunction.getClosestParentByType(ContractDefinition);
  let typeCastFnReference: Expression;
  const typeCastArgs: Expression[] = [];
  if (typeCastLibrary) {
    const ownContract = node.getClosestParentByType(ContractDefinition);
    if (
      !ownContract
        ?.getChildrenByType(UsingForDirective)
        .find((dir) => dir.vLibraryName?.name === typeCastLibrary.name)
    ) {
      const identifier = factory.makeIdentifierPath(typeCastLibrary.name, typeCastLibrary.id);
      ownContract?.insertAtBeginning(
        factory.makeUsingForDirective(false, identifier, undefined, undefined)
      );
    }
    typeCastFnReference = factory.makeMemberAccess(
      "",
      fnReference,
      typeCastFunction.name,
      typeCastFunction.id
    );
  } else {
    typeCastFnReference = factory.makeIdentifierFor(typeCastFunction);
    typeCastArgs.push(fnReference);
  }
  return makeFunctionCallFor(typeCastFnReference, typeCastArgs);
}

/**
 * Inserts a VariableDeclarationStatement node at the beginning of the body
 * of `fn` which assigns the variable for `parameter` to a `FunctionCall` node
 * for the associated decoding function in `decoderSourceUnit`.
 *
 * @param factory - The ASTNodeFactory instance to use for creating nodes
 * @param sourceUnit - The SourceUnit node containing `fn`
 * @param decoderSourceUnit - The SourceUnit node containing the decoding functions
 * @param fn - The FunctionDefinition node to insert the VariableDeclarationStatement into
 * @param parameter - The VariableDeclaration node to assign
 * @param parameterType - The TypeNode of `parameter`
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

  const decodeFunctionName = NameGen.innerAbiDecode(parameterType);
  const typecastFunctionName = NameGen.castReturnType(parameterType);
  const typeCastFunction = findFunctionDefinition(decoderSourceUnit, typecastFunctionName);
  addTypeImport(sourceUnit, typeCastFunction);
  const decodeFnReference = getFunctionReference(sourceUnit, decoderSourceUnit, decodeFunctionName);

  const typeCastFn = getFunctionTypeCastCall(factory, fn, typeCastFunction, decodeFnReference);

  const cdStart = factory.makeIdentifier("CalldataPointer", "CalldataStart", -1);
  const cdPtr = getPointerOffsetExpression(factory, cdStart, parameterType, DataLocation.CallData);

  const functionCall = makeFunctionCallFor(typeCastFn, [cdPtr]);
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
  ).filter((fn) => !fn.isConstructor && fn.visibility === FunctionVisibility.External);
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
