import {
  ASTNodeFactory,
  DataLocation,
  Expression,
  FunctionCall,
  FunctionCallKind,
  FunctionStateMutability,
  assert,
  replaceNode
} from "solc-typed-ast";
import { WrappedScope } from "../../ctx/contract_wrapper";
import { abiEncodingFunction } from "./abi_encode_visitor";
import { TupleType } from "../../../ast";
import NameGen from "../../names";
import {
  addImports,
  getFunctionReference,
  getParentSourceUnit,
  isAbiEncodeCall
} from "../../../utils";

/// Create a function that encodes the given type and returns the encoded data
/// as a `bytes` with allocated memory.
export function createAbiEncodingFunctionWithAllocation(
  ctx: WrappedScope,
  type: TupleType,
  encodeCalls: FunctionCall[]
): string {
  const fnName = NameGen.abiEncode(type);
  const encodeFn = abiEncodingFunction(ctx, type);

  const encodeParams = ["data", ...type.vMembers.map((_, i) => `value${i}`)].join(", ");

  const body = [
    `MemoryPointer dst = getFreeMemoryPointer();`,
    `MemoryPointer data = dst.next();`,
    `/// Offset position by 32 bytes to skip the length field`,
    `uint256 size = ${encodeFn}(${encodeParams});`,
    `setFreeMemoryPointer(data.offset(size));`,
    `dst.write(size);`,
    `assembly {`,
    [`out := dst`],
    `}`
  ];
  const params = type.vMembers
    .map((member, i) => member.writeParameter(DataLocation.Memory, `value${i}`))
    .join(", ");

  const cb =
    encodeCalls.length > 0
      ? () => {
          console.log(
            `${fnName} added to AST - replacing ${encodeCalls.length} abi.encode() calls with ${fnName}`
          );
          encodeCalls.forEach((hashCall) => {
            const sourceUnit = getParentSourceUnit(hashCall);
            addImports(sourceUnit, ctx.sourceUnit, []);
            const fn = getFunctionReference(sourceUnit, ctx.sourceUnit, fnName);
            replaceAbiEncodeCall(hashCall, fn, type);
          });
        }
      : undefined;

  return ctx.addInternalFunction(
    fnName,
    params,
    `bytes memory out`,
    body,
    FunctionStateMutability.Pure,
    undefined,
    false,
    cb
  );
}

export function replaceAbiEncodeCall(
  call: FunctionCall,
  encodeFn: Expression,
  type: TupleType
): void {
  assert(isAbiEncodeCall(call), `Expected abi.encode call: ${type.pp()}`);
  const factory = new ASTNodeFactory(call.requiredContext);
  const args = call.vArguments.map((arg) => factory.copy(arg));

  const fnCall = factory.makeFunctionCall(
    call.typeString,
    FunctionCallKind.FunctionCall,
    encodeFn,
    args
  );
  replaceNode(call, fnCall);
}
