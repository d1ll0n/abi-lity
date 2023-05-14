import {
  Expression,
  Identifier,
  assert,
  FunctionCall,
  ExternalReferenceType,
  ASTNode,
  MemberAccess,
  InferType,
  LatestCompilerVersion
} from "solc-typed-ast";

import { typeOfFunctionCallArguments } from "../readers/read_solc_ast";
import { TupleType } from "../ast";

export const isAbiEncodeCall = (expr: Expression): expr is FunctionCall =>
  isBuiltinFunctionCallTo(expr, "abi.encode");

export const isKeccak256Call = (expr: Expression): expr is FunctionCall =>
  isBuiltinFunctionCallTo(expr, "keccak256");

export const isHashCallWithAbiEncode = (expr: Expression): expr is FunctionCall =>
  isKeccak256Call(expr) && expr.vArguments.length === 1 && isAbiEncodeCall(expr.vArguments[0]);

export function getHashCallsWithAbiEncode(scope: ASTNode): FunctionCall[] {
  return scope.getChildrenByType(FunctionCall).filter(isHashCallWithAbiEncode);
}

export function getAbiEncodeCalls(scope: ASTNode): FunctionCall[] {
  return scope.getChildrenByType(FunctionCall).filter(isAbiEncodeCall);
}

export function getAbiEncodeParameterTypes(type: FunctionCall): TupleType {
  assert(isAbiEncodeCall(type), `Expected abi.encode call, got ${type}`);
  return typeOfFunctionCallArguments(type);
}

export function getHashWithAbiEncodeParameterTypes(type: FunctionCall): TupleType {
  if (!isHashCallWithAbiEncode(type)) {
    throw Error(
      `Expected keccak256(abi.encode()) call, got ${new InferType(LatestCompilerVersion).typeOf(
        type
      )}`
    );
  }
  return getAbiEncodeParameterTypes(type.vArguments[0] as FunctionCall);
}

export function isBuiltinFunctionCallTo(call: Expression, name: string): call is FunctionCall {
  if (!(call instanceof FunctionCall && call.vFunctionCallType === ExternalReferenceType.Builtin)) {
    return false;
  }
  const nameParts = name.split(".");
  if (nameParts.length === 1) {
    return call.vFunctionName === name;
  }
  assert(nameParts.length === 2, `Unrecognized builtin function name: ${name}`);
  const vCallee = call.vCallee;
  return (
    call.vFunctionCallType === ExternalReferenceType.Builtin &&
    vCallee instanceof MemberAccess &&
    vCallee.memberName === nameParts[1] &&
    vCallee.vExpression instanceof Identifier &&
    vCallee.vExpression.name === nameParts[0]
  );
}
