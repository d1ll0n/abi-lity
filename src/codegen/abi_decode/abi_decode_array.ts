import { StructuredText, toHex } from "../../utils";
import { ArrayType, BytesType, StructType, TypeNode } from "../../ast";
import { abiDecodingFunction } from "./abi_decode";
import {
  CodegenContext,
  getCalldataDecodingFunction,
  roundUpAdd32,
  canCombineTailCopies,
  canDeriveSizeInOneStep
} from "../utils";
import NameGen from "../names";

function buildGetTailSize(ctx: CodegenContext, type: TypeNode, ptr: string) {
  if (type.maxNestedReferenceTypes > 1) {
    throw Error(
      `getTailSize not implemented for ${type.identifier}\ntoo many nested reference type`
    );
  }
  if (type instanceof BytesType) {
    return roundUpAdd32(ctx, `calldataload(${ptr})`);
  }
  if (type instanceof ArrayType && type.baseType.isValueType) {
    if (type.isDynamicallySized) return `mul(add(calldataload(${ptr}), 1), 0x20)`;
    return toHex(32 * (type.length as number));
  }
  if (type instanceof StructType) {
    return ctx.addConstant(`${type.name}_tail_size`, toHex(type.memoryDataSize as number));
  }

  throw Error(`getTailSize not implemented for ${type.identifier}`);
}

/**
 * Generates an ABI decoding function for an array with a dynamic base type
 * where the tails can be combined into a single copy, assuming strict encoding,
 * which is checked.
 */
function abiDecodingFunctionArrayCombinedDynamicTail(ctx: CodegenContext, type: ArrayType): string {
  if (!canDeriveSizeInOneStep(type.baseType)) {
    throw Error(
      `Can not derive size in one step for ${type.canonicalName} - ${type.baseType.maxNestedDynamicTypes} dynamic ${type.baseType.maxNestedReferenceTypes} reference`
    );
  }
  const fnName = NameGen.abiDecode(type);
  if (ctx.hasFunction(fnName)) return fnName;
  const tailSizeExpression = buildGetTailSize(ctx, type.baseType, `cdPtrItemLength`);

  const body: string[] = [];
  let inPtr = "cdPtrLength";
  let outPtr = "mPtrLength";
  if (type.isDynamicallySized) {
    body.push(
      `let arrLength := calldataload(cdPtrLength)`,
      ``,
      `mPtrLength := mload(0x40)`,
      `mstore(mPtrLength, arrLength)`,
      ``,
      `let mPtrHead := add(mPtrLength, 32)`,
      `let cdPtrHead := add(cdPtrLength, 32)`,
      ` `,
      `let tailOffset :=  mul(arrLength, 0x20)`
    );
  } else {
    inPtr = "cdPtrHead";
    outPtr = "mPtrHead";
    const headSize = ctx.addConstant(
      `${type.identifier}_mem_head_size`,
      toHex(type.embeddedMemoryHeadSize as number)
    );
    body.push(`mPtrHead := mload(0x40)`, `let tailOffset := ${headSize}`);
  }
  body.push(
    ` `,
    `let mPtrTail := add(mPtrHead, tailOffset)`,
    `let totalOffset := tailOffset`,
    `let isInvalid := 0`,
    `for {let offset := 0} lt(offset, tailOffset) { offset := add(offset, 32) } {`,
    `  mstore(add(mPtrHead, offset), add(mPtrHead, totalOffset))`,
    `  let cdOffsetItemLength := calldataload(add(cdPtrHead, offset))`,
    `  isInvalid := or(isInvalid, xor(cdOffsetItemLength, totalOffset))`,
    `  let cdPtrItemLength := add(cdPtrHead, cdOffsetItemLength)`,
    `  let length := ${tailSizeExpression}`,
    `  totalOffset := add(totalOffset, length)`,
    `}`,
    `if isInvalid {revert(0, 0)}`,
    `calldatacopy(`,
    `  mPtrTail,`,
    `  add(cdPtrHead, tailOffset),`,
    `  sub(totalOffset, tailOffset)`,
    `)`,
    `mstore(0x40, add(mPtrHead, totalOffset))`
  );

  const code = getCalldataDecodingFunction(fnName, inPtr, outPtr, [`assembly {`, body, `}`]);

  ctx.addFunction(fnName, code);

  return fnName;
}

/**
 * Generates an ABI decoding function for an array of fixed-size reference types
 * that can be combined into a single copy (no embedded reference types).
 */
function abiDecodingFunctionArrayCombinedStaticTail(ctx: CodegenContext, type: ArrayType): string {
  const fnName = NameGen.abiDecode(type);
  if (ctx.hasFunction(fnName)) return fnName;
  const tailSizeName = ctx.addConstant(
    `${type.baseType.identifier}_mem_tail_size`,
    toHex(type.baseType.memoryDataSize as number)
  );

  const body: StructuredText[] = [];
  let inPtr = "cdPtrLength";
  let outPtr = "mPtrLength";
  let tailSizeExpression = `mul(arrLength, ${tailSizeName})`;
  let copyStartExpression = "add(cdPtrLength, 0x20)";
  if (type.isDynamicallySized) {
    body.push(
      `let arrLength := calldataload(cdPtrLength)`,
      ``,
      `mPtrLength := mload(0x40)`,
      `mstore(mPtrLength, arrLength)`,
      ``,
      `let mPtrHead := add(mPtrLength, 32)`,
      `let mPtrTail := add(mPtrHead, mul(arrLength, 0x20))`
    );
  } else {
    inPtr = "cdPtrHead";
    outPtr = "mPtrHead";
    body.push(
      `mPtrHead := mload(0x40)`,
      `let mPtrTail := add(mPtrHead, ${toHex(32 * (type.length as number))})`
      // `let arrLength := ${type.length}`,
      // `let tailOffset := ${toHex((type.length as number) * 32)}`
    );
    tailSizeExpression = ctx.addConstant(
      `${type.identifier}_mem_tail_size`,
      toHex(type.memoryDataSize as number)
    );
    copyStartExpression = inPtr;
  }
  body.push(
    `let mPtrTailNext := mPtrTail`,
    ` `,
    `/// Copy elements to memory`,
    `/// Calldata does not have individual offsets for array elements with a fixed size.`,
    `calldatacopy(`,
    [`mPtrTail,`, `${copyStartExpression},`, tailSizeExpression],
    `)`,
    "let mPtrHeadNext := mPtrHead",
    ` `,
    `for {} lt(mPtrHeadNext, mPtrTail) {} {`,
    `  mstore(mPtrHeadNext, mPtrTailNext)`,
    `  mPtrHeadNext := add(mPtrHeadNext, 0x20)`,
    `  mPtrTailNext := add(mPtrTailNext, ${tailSizeName})`,
    `}`,
    `mstore(0x40, mPtrTailNext)`
  );

  const code = getCalldataDecodingFunction(fnName, inPtr, outPtr, [`assembly {`, body, `}`]);
  ctx.addFunction(fnName, code);
  return fnName;
}

/**
 * Generates an ABI decoding function for an array of value types.
 */
function abiDecodingFunctionValueArray(ctx: CodegenContext, type: ArrayType): string {
  if (!type.baseType.isValueType) {
    throw Error(`Array with non-value baseType passed to abiDecodingFunctionValueArray`);
  }
  const typeName = type.identifier;
  const fnName = NameGen.abiDecode(type);
  if (ctx.hasFunction(fnName)) return fnName;
  let inPtr = "cdPtrLength";
  let outPtr = "mPtrLength";
  const body: StructuredText[] = [];
  if (type.isDynamicallySized) {
    body.push(
      `unchecked {`,
      [
        `uint256 arrLength = cdPtrLength.readUint256();`, // @todo Does this need to be masked?
        `uint256 arrSize = (arrLength + 1) * 32;`,
        `mPtrLength = malloc(arrSize);`,
        `cdPtrLength.copy(mPtrLength, arrSize);`
      ],
      `}`
    );
  } else {
    inPtr = "cdPtr";
    outPtr = "mPtr";
    const sizeName = ctx.addConstant(`${typeName}_tail_size`, (type.length as number) * 32);
    body.push(`mPtr = malloc(${sizeName});`);
    body.push(`cdPtr.copy(mPtr, ${sizeName});`);
  }
  const code = getCalldataDecodingFunction(fnName, inPtr, outPtr, body);
  ctx.addFunction(fnName, code);
  return fnName;
}

/**
 * Generates an ABI decoding function for an array of reference types which can not
 * be combined into a single copy, i.e. those with embedded reference types.
 */
function abiDecodingFunctionArraySeparateTail(ctx: CodegenContext, type: ArrayType) {
  const typeName = type.identifier;
  const fnName = NameGen.abiDecode(type);
  if (ctx.hasFunction(fnName)) return fnName;
  let inPtr = "cdPtrLength";
  let outPtr = "mPtrLength";
  const body: StructuredText[] = [];
  let tailOffset = "tailOffset";
  const decodeFn = abiDecodingFunction(ctx, type.baseType);
  const cdPtrItem = type.baseType.isDynamicallyEncoded
    ? `cdPtrHead.pptr(offset)`
    : `cdPtrHead.offset(offset)`;

  if (type.isDynamicallySized) {
    body.push(
      `unchecked {`,
      [
        `uint256 arrLength = cdPtrLength.readUint256();`,
        `uint256 tailOffset = arrLength * 32;`,
        `mPtrLength = malloc(tailOffset + 32);`,
        `mPtrLength.write(arrLength);`,
        `MemoryPointer mPtrHead = mPtrLength.next();`,
        `CalldataPointer cdPtrHead = cdPtrLength.next();`,
        ``,
        `for (uint256 offset; offset < tailOffset; offset += 32) {`,
        [`mPtrHead.offset(offset).write(${decodeFn}(${cdPtrItem}));`],
        `}`
      ],
      `}`
    );
  } else {
    inPtr = "cdPtrHead";
    outPtr = "mPtrHead";
    const headSize = ctx.addConstant(
      `${typeName}_memory_head_size`,
      toHex(type.embeddedMemoryHeadSize)
    );
    tailOffset = headSize;
    body.push(
      `mPtrHead = malloc(${tailOffset});`,
      ``,
      `for (uint256 offset; offset < ${tailOffset}; offset += 32) {`,
      [`mPtrHead.offset(offset).write(${decodeFn}(${cdPtrItem}));`],
      `}`
    );
  }

  const code = getCalldataDecodingFunction(fnName, inPtr, outPtr, body);

  ctx.addFunction(fnName, code);
  return fnName;
}

export function abiDecodingFunctionArray(ctx: CodegenContext, type: ArrayType): string {
  if (type.baseType.isValueType) {
    return abiDecodingFunctionValueArray(ctx, type);
  }
  if (canCombineTailCopies(type.baseType)) {
    if (type.baseType.isDynamicallyEncoded) {
      return abiDecodingFunctionArrayCombinedDynamicTail(ctx, type);
    }
    return abiDecodingFunctionArrayCombinedStaticTail(ctx, type);
  }
  return abiDecodingFunctionArraySeparateTail(ctx, type);
}
