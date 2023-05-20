import {
  ASTNodeFactory,
  DataLocation,
  FunctionCallKind,
  Expression,
  replaceNode,
  FunctionStateMutability,
  assert,
  FunctionCall
} from "solc-typed-ast";
import { ArrayType, BytesType, TupleType, TypeNode } from "../../../ast";
import {
  addImports,
  getFunctionReference,
  getParentSourceUnit,
  isHashCallWithAbiEncode,
  toHex
} from "../../../utils";
import { abiEncodingFunction } from "./abi_encode_visitor";
import NameGen from "../../names";
import { WrappedScope } from "../../ctx/contract_wrapper";
import { abiEncodingMatchesMemoryLayout } from "../../utils";

// @todo Skip encoding where data is laid out the same in solc memory as it is in the ABI

export function createHashFunction(
  ctx: WrappedScope,
  type: TupleType,
  hashCalls: FunctionCall[] = []
): string {
  const fnName = NameGen.hash(type);
  const body = [];
  if (isValueTuple(type)) {
    body.push(...hashValueTuple(type.vMembers.length));
  } else {
    const encodeFn = abiEncodingFunction(ctx, type);
    let dst = "dst";
    const useScratch = !type.isDynamicallyEncoded && type.embeddedCalldataHeadSize <= 0x80;
    const restoreFreePointer = useScratch && type.embeddedCalldataHeadSize > 64;
    const restoreZeroSlot = useScratch && type.embeddedCalldataHeadSize > 96;
    if (useScratch) {
      dst = "ScratchPtr";
    } else {
      body.push(`MemoryPointer dst = getFreeMemoryPointer();`);
    }
    const encodeParams = [dst, ...type.vMembers.map((member, i) => `value${i}`)].join(", ");

    body.push(`uint256 size = ${encodeFn}(${encodeParams});`);
    body.push(`out = ${dst}.hash(size);`);
    if (restoreFreePointer) {
      body.unshift(
        `// Cache the free memory pointer so we can restore it after the hash is calculated`,
        `MemoryPointer freePtr = getFreeMemoryPointer();`
      );
      body.push(`setFreeMemoryPointer(freePtr);`);
    }

    if (restoreZeroSlot) {
      body.push(
        `// Restore the zero slot (0x60) which was overwritten by the hash calculation`,
        `restoreZeroSlot();`
      );
    }
  }

  const params = type.vMembers
    .map((member, i) => member.writeParameter(DataLocation.Memory, `value${i}`))
    .join(", ");
  console.log(`Creating hash function ${fnName}(${params})`);
  const cb =
    hashCalls.length > 0
      ? () => {
          console.log(
            `${fnName} added to AST - replacing ${hashCalls.length} keccak256(abi.encode()) calls with ${fnName}`
          );
          hashCalls.forEach((hashCall) => {
            const sourceUnit = getParentSourceUnit(hashCall);
            addImports(sourceUnit, ctx.sourceUnit, []);
            const fn = getFunctionReference(sourceUnit, ctx.sourceUnit, fnName);
            replaceHashCall(hashCall, fn, type);
          });
        }
      : undefined;
  return ctx.addInternalFunction(
    fnName,
    params,
    `bytes32 out`,
    body,
    FunctionStateMutability.Pure,
    undefined,
    undefined,
    cb
  );
}

export function replaceHashCall(call: FunctionCall, hashFn: Expression, type: TupleType): void {
  assert(isHashCallWithAbiEncode(call), `Expected hash call with abi.encode: ${type.pp()}`);
  const factory = new ASTNodeFactory(call.requiredContext);
  const args = (call.vArguments[0] as FunctionCall).vArguments.map((arg) => factory.copy(arg));

  const fnCall = factory.makeFunctionCall(
    call.vArguments[0].typeString,
    FunctionCallKind.FunctionCall,
    hashFn,
    args
  );
  replaceNode(call, fnCall);
}

const isValueTuple = (type: TupleType) =>
  type.vMembers.length <= 4 && type.vMembers.every((m) => m.isValueType);

const hashValueTuple = (length: number) => {
  const innerBody = [];
  if (length > 3) {
    innerBody.push(
      `// Cache the free memory pointer so we can restore it after the hash is calculated`,
      `let freePointer := mload(0x40)`
    );
  }
  for (let i = 0; i < length; i++) {
    const offset = toHex(i * 32);
    if (i === 0) innerBody.push(`mstore(0, value${i})`);
    else innerBody.push(`mstore(${offset}, value${i})`);
  }

  const size = toHex(length * 32);
  innerBody.push(`out := keccak256(0, ${size})`);
  if (length > 2) {
    innerBody.push(`// Restore the zero slot`, `mstore(0x60, 0)`);
    if (length > 3) {
      innerBody.push(`// Restore the free memory pointer`, `mstore(0x40, freePointer)`);
    }
  }
  return [`assembly {`, innerBody, `}`];
};

function getDataSize(ctx: WrappedScope, type: TypeNode) {
  // const encodedSizeExpression = this.getConstant(
  // "encodedSize",
  // toHex(type.calldataEncodedSize as number),
  // type
  // );
  assert(
    abiEncodingMatchesMemoryLayout(type),
    `Called getDataSize with type whose ABI and memory encodings differ: ${type.pp()}`
  );
  if (!type.isDynamicallyEncoded) {
    return ctx.getConstant(NameGen.encodedSize(type), toHex(type.calldataEncodedSize));
  }
  if (type instanceof ArrayType) {
    return `(src.readUint256() + 1) << OneWordShift`;
  }
  if (type instanceof BytesType) {
    return `(src.readUint256() + SixtyThreeBytes) & OnlyFullWordMask`;
  }
  throw new Error(`getDataSize not implemented for ${type.pp()}`);
}
