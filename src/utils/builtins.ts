/**
 * Detectors and extractors for Solidity built-in function calls
 * (`abi.encode`, `keccak256`, etc.) in the solc-typed-ast tree.
 */
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

/** Type guard: returns `true` if `expr` is a call to `abi.encode`. */
export const isAbiEncodeCall = (expr: Expression): expr is FunctionCall =>
  isBuiltinFunctionCallTo(expr, "abi.encode");

/** Type guard: returns `true` if `expr` is a call to `keccak256`. */
export const isKeccak256Call = (expr: Expression): expr is FunctionCall =>
  isBuiltinFunctionCallTo(expr, "keccak256");

/** Type guard: returns `true` if `expr` is `keccak256(abi.encode(...))`. */
export const isHashCallWithAbiEncode = (expr: Expression): expr is FunctionCall =>
  isKeccak256Call(expr) && expr.vArguments.length === 1 && isAbiEncodeCall(expr.vArguments[0]);

/** Finds all `keccak256(abi.encode(...))` calls within `scope`. */
export function getHashCallsWithAbiEncode(scope: ASTNode): FunctionCall[] {
  return scope.getChildrenByType(FunctionCall).filter(isHashCallWithAbiEncode);
}

/** Finds all `abi.encode(...)` calls within `scope`. */
export function getAbiEncodeCalls(scope: ASTNode): FunctionCall[] {
  return scope.getChildrenByType(FunctionCall).filter(isAbiEncodeCall);
}

/** Extracts the argument types from an `abi.encode(...)` call as a TupleType. */
export function getAbiEncodeParameterTypes(type: FunctionCall): TupleType {
  assert(isAbiEncodeCall(type), `Expected abi.encode call, got ${type}`);
  return typeOfFunctionCallArguments(type);
}

/** Extracts the argument types from a `keccak256(abi.encode(...))` call as a TupleType. */
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

/**
 * Type guard: returns `true` if `call` is a built-in function call matching `name`.
 * Supports dotted names like `"abi.encode"` (checks MemberAccess pattern).
 */
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
