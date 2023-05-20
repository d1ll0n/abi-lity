/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  ASTNodeFactory,
  DataLocation,
  FunctionCallKind,
  Expression,
  replaceNode,
  FunctionStateMutability,
  EmitStatement
} from "solc-typed-ast";
import { EventType, TupleType, TypeNode } from "../../../ast";
import { addImports, getFunctionReference, getParentSourceUnit, toHex } from "../../../utils";
import { abiEncodingFunction } from "./abi_encode_visitor";
import NameGen from "../../names";
import { WrappedScope } from "../../ctx/contract_wrapper";
import { createHashFunction } from "./create_hash";

export function createEmitFunction(
  ctx: WrappedScope,
  type: EventType,
  emitStatements: EmitStatement[]
): string {
  const fnName = NameGen.emit(type);
  const encodeFn = abiEncodingFunction(ctx, type);
  const body = [];
  let dst = "dst";

  const topic0 = type.topic0;
  const { indexedParameters, unindexedParameters } = type;

  const members = type.parameters?.vMembers ?? [];
  const topics = [];
  if (topic0) {
    topics.push(topic0);
  }
  for (let i = 0; i < indexedParameters.length; i++) {
    const param = indexedParameters[i];
    const inputName = `value${members.indexOf(param)}`;
    const name = `topic${type.topic0 ? i + 1 : i}`;

    if (param.isReferenceType) {
      const hashFn = createHashFunction(ctx, new TupleType([param]), []);
      body.push(`bytes32 ${name} = ${hashFn}(${inputName});`);
      topics.push(name);
    } else {
      topics.push(inputName);
    }
  }
  if (isValueTuple(unindexedParameters)) {
    body.push(...emitValueTuple(topics, unindexedParameters.length));
  } else {
    const logFn = `log${topics.length}`;
    const params = new TupleType(unindexedParameters);
    const useScratch = !params.isDynamicallyEncoded && params.embeddedCalldataHeadSize <= 0x80;
    if (useScratch) {
      dst = "ScratchPtr";
    } else {
      body.push(`MemoryPointer dst = getFreeMemoryPointer();`);
    }
    const encodeParams = [dst, ...unindexedParameters.map((_, i) => `value${i}`)].join(", ");

    body.push(`uint256 size = ${encodeFn}(${encodeParams});`);
    body.push([`assembly {`, [`${logFn}(${dst}, size, ${topics.join(", ")}, ${dst})`], `}`]);
  }

  const params = members
    .map((member, i) => member.writeParameter(DataLocation.Memory, `value${i}`))
    .join(", ");

  const cb =
    emitStatements.length > 0
      ? () => {
          console.log(
            `${fnName} added to AST - replacing ${emitStatements.length} emit statements with ${fnName}`
          );
          emitStatements.forEach((hashCall) => {
            const sourceUnit = getParentSourceUnit(hashCall);
            addImports(sourceUnit, ctx.sourceUnit, []);
            const fn = getFunctionReference(sourceUnit, ctx.sourceUnit, fnName);
            replaceEmitStatement(hashCall, fn);
          });
        }
      : undefined;

  return ctx.addInternalFunction(
    fnName,
    params,
    undefined,
    body,
    FunctionStateMutability.NonPayable,
    undefined,
    false,
    cb
  );
}

export function replaceEmitStatement(stmt: EmitStatement, emitFn: Expression): void {
  const factory = new ASTNodeFactory(stmt.requiredContext);
  const call = stmt.vEventCall;
  const args = call.vArguments.map((arg) => factory.copy(arg));

  const fnCall = factory.makeFunctionCall(
    call.typeString,
    FunctionCallKind.FunctionCall,
    emitFn,
    args
  );
  const newStmt = factory.makeExpressionStatement(fnCall);
  replaceNode(stmt, newStmt);
}

const isValueTuple = (types: TypeNode[]) => types.length <= 4 && types.every((m) => m.isValueType);

const emitValueTuple = (topics: string[], length: number) => {
  const innerBody = [];
  if (length > 3) {
    innerBody.push(
      `// Cache the free memory pointer so we can restore it after the event is emitted`,
      `let freePointer := mload(0x40)`
    );
  }
  for (let i = 0; i < length; i++) {
    const offset = toHex(i * 32);
    if (i === 0) innerBody.push(`mstore(0, value${i})`);
    else innerBody.push(`mstore(${offset}, value${i})`);
  }

  const size = toHex(length * 32);
  const logFn = `log${topics.length}`;
  const args = [`0`, size, ...topics].join(", ");
  innerBody.push(`${logFn}(${args})`);
  if (length > 2) {
    innerBody.push(`// Restore the zero slot`, `mstore(0x60, 0)`);
    if (length > 3) {
      innerBody.push(`// Restore the free memory pointer`, `mstore(0x40, freePointer)`);
    }
  }
  return [`assembly {`, innerBody, `}`];
};
