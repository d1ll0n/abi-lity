import {
  ASTNodeFactory,
  Block,
  DataLocation,
  FunctionCallKind,
  FunctionDefinition,
  Mutability,
  ParameterList,
  SourceUnit,
  StateVariableVisibility,
  VariableDeclaration,
  Assignment,
  Expression,
  ExpressionStatement,
  Identifier,
  replaceNode,
  Return,
  TupleExpression,
  FunctionStateMutability
} from "solc-typed-ast";
import { ArrayType, BytesType, FunctionType, TupleType } from "../../../ast";
import {
  addUniqueFunctionDefinition,
  makeElementaryTypeConversion,
  makeGlobalFunctionDefinition,
  makeVariableDeclarationStatement,
  toHex
} from "../../../utils";
import { abiEncodingFunction } from "./abi_encode_visitor";
import NameGen from "../../names";
import { WrappedScope } from "../../ctx/contract_wrapper";
import { getParametersTypeString, last } from "../../../utils";
import { EncodingScheme } from "../../../constants";

const ensureHasName = (parameter: VariableDeclaration, i: number) => {
  if (!parameter.name) {
    parameter.name = `value${i}`;
  }
};

export function createReturnFunctionForReturnParameters(
  factory: ASTNodeFactory,
  returnParameters: ParameterList,
  fnType: FunctionType,
  decoderSourceUnit: SourceUnit
): FunctionDefinition {
  if (!fnType.returnParameters) {
    throw Error(`Can not make return function for function with no return parameters`);
  }
  const tuple = fnType.returnParameters as TupleType;
  const paramIdentifier =
    tuple.vMembers.length === 1 ? tuple.vMembers[0].identifier : tuple.identifier;
  const name = `return_${paramIdentifier}`;

  // Get parameters with names
  const parametersList = factory.copy(returnParameters);
  const parameters = parametersList.vParameters;
  parameters.forEach(ensureHasName);

  // Define return function
  const returnFn = makeGlobalFunctionDefinition(
    decoderSourceUnit,
    name,
    factory.copy(returnParameters)
  );
  returnFn.vParameters.vParameters.forEach(ensureHasName);
  const body = returnFn.vBody as Block;

  const returnTypeString = getParametersTypeString(parameters);

  const ids = parameters.map((p) => factory.makeIdentifierFor(p));
  const abiEncode = factory.makeIdentifier(returnTypeString, `abi.encode`, -1);
  const encodeCall = factory.makeFunctionCall(
    returnTypeString,
    FunctionCallKind.FunctionCall,
    abiEncode,
    ids
  );

  const bytesTypeName = factory.makeElementaryTypeName("bytes", "bytes", "nonpayable");
  const returnData = factory.makeVariableDeclaration(
    false,
    false,
    `returnData`,
    returnFn.id,
    false,
    DataLocation.Memory,
    StateVariableVisibility.Default,
    Mutability.Mutable,
    "",
    undefined,
    bytesTypeName
  );

  const returnDataDecl = makeVariableDeclarationStatement(returnData, encodeCall);
  body.appendChild(returnDataDecl);
  const returnDataId = factory.makeYulIdentifierFor(returnData);
  const returnCall = factory.makeYulFunctionCall(factory.makeYulIdentifier("return"), [
    returnDataId.add(32),
    returnDataId.mload()
  ]);
  const asm = factory.makeYulBlock([returnCall]);
  body.appendChild(factory.makeInlineAssembly([], undefined, asm));
  addUniqueFunctionDefinition(decoderSourceUnit, returnFn);

  return returnFn;
}

const isValueTuple = (type: TupleType) => type.vMembers.every((m) => m.isValueType);

const encodeValueTuple = (paramNames: string[]) => {
  const innerBody = [];
  for (let i = 0; i < paramNames.length; i++) {
    const offset = toHex(i * 32);
    if (i === 0) innerBody.push(`mstore(0, ${paramNames[i]})`);
    else innerBody.push(`mstore(${offset}, ${paramNames[i]})`);
  }
  const size = toHex(paramNames.length * 32);
  innerBody.push(`return(0, ${size})`);
  return [`assembly {`, innerBody, `}`];
};

export function createReturnFunction(ctx: WrappedScope, type: TupleType): string {
  const fnName = NameGen.return(type);
  const body = [];
  const paramNames = type.getIndexedNames(`value`);
  if (isValueTuple(type)) {
    body.push(...encodeValueTuple(paramNames));
  } else if (
    type.vMembers.length === 1 &&
    (type.vMembers[0] instanceof BytesType ||
      (type.vMembers[0] instanceof ArrayType && type.vMembers[0].baseType.isValueType))
  ) {
    console.log(`Entering bytes return`);
    const member = type.vMembers[0];
    if (member instanceof BytesType) {
      body.push(
        `assembly {`,
        [
          `let ptr := sub(value, 0x20)`,
          `mstore(ptr, 0x20)`,
          `/// Round up to nearest word and add 2 words for length and offset`,
          `let size := and(add(mload(value), NinetyFiveBytes), OnlyFullWordMask)`,
          `return(ptr, size)`
        ],
        `}`
      );
    } else {
      const assemblyBody = [];
      let ptr: string;
      let size: string;
      if (member.isDynamicallySized) {
        assemblyBody.push(
          `let ptr := sub(value, 0x20)`,
          `mstore(ptr, 0x20)`,
          `/// Get size of array data and add two words for length and offset`,
          `let size := shl(OneWordShift, add(mload(length), 2))`
        );
        size = `size`;
        ptr = "ptr";
      } else {
        ptr = "value";
        size = ctx.addConstant(
          NameGen.headSize(member, EncodingScheme.ABI),
          toHex(type.calldataHeadSize)
        );
      }
      assemblyBody.push(`return(${ptr}, ${size})`);
      body.push(`assembly {`, assemblyBody, `}`);
    }
  } else {
    const encodeFn = abiEncodingFunction(ctx, type);
    let dst = "dst";
    const useScratch = !type.isDynamicallyEncoded && type.embeddedCalldataHeadSize <= 0x80;
    if (useScratch) {
      dst = "ScratchPtr";
    } else {
      body.push(`MemoryPointer dst = getFreeMemoryPointer();`);
    }
    const encodeParams =
      paramNames.length > 1 ? [dst, ...paramNames].join(", ") : `${paramNames[0]}, ${dst}`;
    body.push(`uint256 size = ${encodeFn}(${encodeParams});`);
    body.push(`${dst}.returnData(size);`);
  }

  const params = type.vMembers
    .map((member, i) => member.writeParameter(DataLocation.Memory, paramNames[i]))
    .join(", ");
  return ctx.addInternalFunction(fnName, params, undefined, body, FunctionStateMutability.Pure);
}

export function replaceReturnStatementsWithCall(
  fn: FunctionDefinition,
  returnFn: FunctionDefinition,
  removeParameter?: boolean
): void {
  const { vBody, vReturnParameters } = fn;
  if (!vReturnParameters.children.length || !vBody) return;

  const factory = new ASTNodeFactory(fn.requiredContext);

  const returnStatements = fn.getChildrenByType(Return, true);
  const returnTypeString = getParametersTypeString(vReturnParameters.vParameters);
  const returnFnIdentifier = factory.makeIdentifierFor(returnFn);

  const statements = vBody?.vStatements ?? [];
  const lastStatement = last(statements);
  const lastStatementIsReturn = returnStatements.some(
    (st) => st === lastStatement || st.getParentsBySelector((p) => p === lastStatement).length > 0
  );

  const makeReturnCallStatement = (args: Expression[]) => {
    for (let i = 0; i < args.length; i++) {
      const _arg = args[i];
      if (_arg.typeString.startsWith("contract")) {
        args[i] = makeElementaryTypeConversion(factory, "address", _arg);
      }
    }
    return factory.makeExpressionStatement(
      factory.makeFunctionCall(
        returnTypeString,
        FunctionCallKind.FunctionCall,
        returnFnIdentifier,
        args
      )
    );
  };

  for (const returnStatement of returnStatements) {
    let args = returnStatement.children as Expression[];
    if (args.length === 1) {
      const arg = args[0];
      if (arg instanceof TupleExpression) {
        args = [...arg.vComponents];
      }
    }
    // console.log(args.map((a) => [a.type, a.typeString]));
    replaceNode(returnStatement, makeReturnCallStatement(args));
  }
  // @todo Handle cases where some parameters are not named
  const parameterDeclarations: VariableDeclaration[] = [];
  const returnParameters = [...vReturnParameters.children] as VariableDeclaration[];
  for (const parameter of returnParameters) {
    // Define return params at start of body
    if (parameter.name) {
      const references = fn
        .getChildrenByType(Identifier)
        .filter((node) => node.name === parameter.name);
      if (references.length) {
        const copy = factory.copy(parameter);
        parameterDeclarations.push(copy);
        const statement = factory.makeVariableDeclarationStatement([copy.id], [copy]);
        // If first reference to return parameter is inside an assignment,
        // replace the assignment with a variable declaration statement
        const assignment = references[0].getClosestParentByType(Assignment);
        if (
          assignment?.parent instanceof ExpressionStatement &&
          assignment?.parent.parent === vBody
        ) {
          statement.vInitialValue = assignment.vRightHandSide;
          replaceNode(assignment.parent, statement);
        } else {
          vBody.insertAtBeginning(statement);
        }
      }
    }
    // Remove return parameter
    if (removeParameter) {
      vReturnParameters.removeChild(parameter);
    } else {
      parameter.name = "";
    }
  }
  if (!lastStatementIsReturn && parameterDeclarations.length) {
    const args = parameterDeclarations.map((p) => factory.makeIdentifierFor(p));
    vBody.appendChild(makeReturnCallStatement(args));
  }
}
