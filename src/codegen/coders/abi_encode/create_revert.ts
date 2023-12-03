import {
  ASTNodeFactory,
  DataLocation,
  FunctionCallKind,
  VariableDeclaration,
  Expression,
  replaceNode,
  FunctionStateMutability,
  RevertStatement
} from "solc-typed-ast";
import { ArrayType, BytesType, ErrorType, TupleType, TypeNode } from "../../../ast";
import { addImports, getFunctionReference, getParentSourceUnit, toHex } from "../../../utils";
import { abiEncodingFunction } from "./abi_encode_visitor";
import NameGen from "../../names";
import { WrappedScope } from "../../ctx/contract_wrapper";
import { EncodingScheme } from "../../../constants";

const ensureHasName = (parameter: VariableDeclaration, i: number) => {
  if (!parameter.name) {
    parameter.name = `value${i}`;
  }
};

export function createRevertFunction(
  ctx: WrappedScope,
  type: ErrorType,
  revertStatements: RevertStatement[]
): string {
  const fnName = NameGen.revert(type);
  const body = [];

  const members = type.parameters?.vMembers ?? [];
  const paramNames = type.parameters?.getIndexedNames(`value`) ?? [];

  if (isValueTuple(members)) {
    // const selector = ctx.getNameGenConstant("selector", type.errorSelector, type);
    body.push(...encodeValueTuple([type.errorSelector, ...paramNames]));
  } else if (
    members.length === 1 &&
    (members[0] instanceof BytesType ||
      (members[0] instanceof ArrayType && members[0].baseType.isValueType))
  ) {
    console.log(`Entering bytes return`);

    const selector = ctx.getNameGenConstant("selector", type.errorSelector.padEnd(66, "0"), type);

    const member = members[0];
    if (member instanceof BytesType) {
      body.push(
        `assembly {`,
        [
          `let ptr := sub(value, 0x24)`,
          `mstore(ptr, ${selector})`,
          `mstore(add(ptr, 0x04), 0x20)`,
          `/// Round up to nearest word and add 2 words for length and offset`,
          `let size := and(add(mload(value), NinetyFiveBytes), OnlyFullWordMask)`,
          `revert(ptr, add(size, 4))`
        ],
        `}`
      );
    } else {
      const assemblyBody = [];
      let ptr: string;
      let size: string;
      if (member.isDynamicallySized) {
        assemblyBody.push(
          `let ptr := sub(value, 0x24)`,
          `mstore(ptr, ${selector})`,
          `mstore(add(ptr, 0x04), 0x20)`,
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
        assemblyBody.push(
          `let ptr := sub(value, 4)`,
          // @todo fix this, use right-aligned selector
          `mstore(sub(value, 0x20), shr(224, ${selector}))`
        );
      }
      assemblyBody.push(`revert(${ptr}, add(${size}, 4))`);
      body.push(`assembly {`, assemblyBody, `}`);
    }
  } else {
    const encodeFn = abiEncodingFunction(ctx, type);
    let dst = "dst";
    // @todo clean-up jankiness of tuple handling
    const tuple = type.parameters ?? new TupleType([]);
    const useScratch = !tuple.isDynamicallyEncoded && tuple.embeddedCalldataHeadSize <= 0x80;
    if (useScratch) {
      dst = "ScratchPtr";
    } else {
      body.push(`MemoryPointer dst = getFreeMemoryPointer();`);
    }
    const encodeParams =
      paramNames.length > 1 ? [dst, ...paramNames].join(", ") : `${paramNames[0]}, ${dst}`;
    body.push(`uint256 size = ${encodeFn}(${encodeParams});`);
    body.push(`${dst}.revertData(size);`);
  }

  const params = members
    .map((member, i) => member.writeParameter(DataLocation.Memory, `value${i}`))
    .join(", ");

  const cb =
    revertStatements.length > 0
      ? () => {
          console.log(
            `${fnName} added to AST - replacing ${revertStatements.length} revert statements with ${fnName}`
          );
          revertStatements.forEach((revertCall) => {
            const sourceUnit = getParentSourceUnit(revertCall);
            addImports(sourceUnit, ctx.sourceUnit, []);
            const fn = getFunctionReference(sourceUnit, ctx.sourceUnit, fnName);
            replaceRevertStatement(revertCall, fn);
          });
        }
      : undefined;

  return ctx.addInternalFunction(
    fnName,
    params,
    undefined,
    body,
    FunctionStateMutability.Pure,
    undefined,
    false,
    cb
  );
}

const isValueTuple = (types: TypeNode[]) => types.every((m) => m.isValueType);

const encodeValueTuple = (paramNames: string[]) => {
  const innerBody = [];
  for (let i = 0; i < paramNames.length; i++) {
    const offset = toHex(i * 32);
    if (i === 0) innerBody.push(`mstore(0, ${paramNames[i]})`);
    else innerBody.push(`mstore(${offset}, ${paramNames[i]})`);
  }
  const size = toHex((paramNames.length - 1) * 32 + 4);
  innerBody.push(`revert(0x1c, ${size})`);
  return [`assembly {`, innerBody, `}`];
};

export function replaceRevertStatement(stmt: RevertStatement, revertFn: Expression): void {
  const factory = new ASTNodeFactory(stmt.requiredContext);
  const call = stmt.errorCall;
  const args = call.vArguments.map((arg) => factory.copy(arg));

  const fnCall = factory.makeFunctionCall(
    call.typeString,
    FunctionCallKind.FunctionCall,
    revertFn,
    args
  );
  const newStmt = factory.makeExpressionStatement(fnCall);
  replaceNode(stmt, newStmt);
}
