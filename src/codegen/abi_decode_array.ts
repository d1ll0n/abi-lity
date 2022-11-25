import { toHex } from "../utils";
import { ArrayType, BytesType, StructType, TypeNode } from "../ast";
import {
  canCombineTailCopies,
  canDeriveSizeInOneStep,
  DecoderContext,
  roundUpAdd32
} from "./utils";
import { abiDecodingFunction } from "./abi_decode";

function buildGetTailSize(ctx: DecoderContext, type: TypeNode, ptr: string) {
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
function abiDecodingFunctionArrayCombinedDynamicTail(ctx: DecoderContext, type: ArrayType): string {
  if (!canDeriveSizeInOneStep(type.baseType)) {
    throw Error(
      `Can not derive size in one step for ${type.canonicalName} - ${type.baseType.maxNestedDynamicTypes} dynamic ${type.baseType.maxNestedReferenceTypes} reference`
    );
  }
  const typeName = type.identifier;
  const fnName = `abi_decode_${typeName}`;
  if (ctx.hasFunction(fnName)) return fnName;
  const tailSizeExpression = buildGetTailSize(ctx, type.baseType, `cdPtrItemLength`);

  const headSetter: string[] = [];
  let inPtr = "cdPtrLength";
  let outPtr = "mPtrLength";
  if (type.isDynamicallySized) {
    headSetter.push(
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
    headSetter.push(
      `mPtrHead := mload(0x40)`,
      // `let arrLength := ${type.length}`,
      `let tailOffset := ${toHex((type.length as number) * 32)}`
    );
  }

  const code = [
    `function ${fnName}(${inPtr}) -> ${outPtr} {`,
    [
      ...headSetter,
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
    ],
    `}`
  ];

  ctx.addFunction(fnName, code);

  return fnName;
}

/**
 * Generates an ABI decoding function for an array of fixed-size reference types
 * that can be combined into a single copy (no embedded reference types).
 */
function abiDecodingFunctionArrayCombinedStaticTail(ctx: DecoderContext, type: ArrayType): string {
  const typeName = type.identifier;
  const fnName = `abi_decode_${typeName}`;
  if (ctx.hasFunction(fnName)) return fnName;
  const tailSizeName = ctx.addConstant(
    `${type.baseType.identifier}_mem_tail_size`,
    toHex(type.baseType.memoryDataSize as number)
  );

  const headSetter: string[] = [];
  let inPtr = "cdPtrLength";
  let outPtr = "mPtrLength";
  let tailSizeExpression = `mul(arrLength, ${tailSizeName})`;
  let copyStartExpression = "add(cdPtrLength, 0x20)";
  if (type.isDynamicallySized) {
    headSetter.push(
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
    headSetter.push(
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

  const code = [
    `function ${fnName}(${inPtr}) -> ${outPtr} {`,
    [
      ...headSetter,
      `let mPtrTailNext := mPtrTail`,
      ` `,
      `// Copy elements to memory`,
      `// Calldata does not have individual offsets for array elements with a fixed size.`,
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
    ],
    `}`
  ];
  ctx.addFunction(fnName, code);
  return fnName;
}

/**
 * Generates an ABI decoding function for an array of value types.
 */
function abiDecodingFunctionValueArray(ctx: DecoderContext, type: ArrayType): string {
  if (!type.baseType.isValueType) {
    throw Error(`Array with non-value baseType passed to abiDecodingFunctionValueArray`);
  }
  const typeName = type.identifier;
  const fnName = `abi_decode_${typeName}`;
  if (ctx.hasFunction(fnName)) return fnName;
  let inPtr = "cdPtrLength";
  let outPtr = "mPtrLength";
  const body: string[] = [];
  if (type.isDynamicallySized) {
    body.push(
      `let arrLength := calldataload(cdPtrLength)`,
      `let arrSize := mul(add(arrLength, 1), 0x20)`,
      `calldatacopy(mPtrLength, cdPtrLength, arrSize)`,
      `mstore(0x40, add(mPtrLength, arrSize))`
    );
  } else {
    inPtr = "cdPtr";
    outPtr = "mPtr";
    const sizeName = ctx.addConstant(`${typeName}_tail_size`, (type.length as number) * 32);
    body.push(`calldatacopy(mPtr, cdPtr, ${sizeName})`, `mstore(0x40, add(mPtr, ${sizeName}))`);
  }
  const code = [
    `function ${fnName}(${inPtr}) -> ${outPtr} {`,
    [`${outPtr} := mload(0x40)`, ...body],
    `}`
  ];
  ctx.addFunction(fnName, code);
  return fnName;
}

/**
 * Generates an ABI decoding function for an array of reference types which can not
 * be combined into a single copy, i.e. those with embedded reference types.
 */
function abiDecodingFunctionArraySeparateTail(ctx: DecoderContext, type: ArrayType) {
  const typeName = type.identifier;
  const fnName = `abi_decode_${typeName}`;
  if (ctx.hasFunction(fnName)) return fnName;
  let inPtr = "cdPtrLength";
  let outPtr = "mPtrLength";
  const headSetter: string[] = [];
  if (type.isDynamicallySized) {
    headSetter.push(
      `let arrLength := calldataload(cdPtrLength)`,
      ``,
      `mPtrLength := mload(0x40)`,
      `mstore(mPtrLength, arrLength)`,
      ``,
      `let mPtrHead := add(mPtrLength, 0x20)`,
      `let cdPtrHead := add(cdPtrLength, 0x20)`,
      `let tailOffset := mul(arrLength, 0x20)`
    );
  } else {
    inPtr = "cdPtrHead";
    outPtr = "mPtrHead";
    const headSize = ctx.addConstant(
      `${typeName}_memory_head_size`,
      toHex(type.embeddedMemoryHeadSize)
    );
    headSetter.push(`mPtrHead := mload(0x40)`, `let tailOffset := ${headSize}`);
  }
  const cdPtrItem = type.baseType.isDynamicallyEncoded
    ? `add(cdPtrHead, calldataload(add(cdPtrHead, offset)))`
    : `add(cdPtrHead, offset)`;

  const decodeFn = abiDecodingFunction(ctx, type.baseType);
  const code = [
    `function ${fnName}(${inPtr}) -> ${outPtr} {`,
    [
      ...headSetter,
      `mstore(0x40, add(mPtrHead, tailOffset))`,
      ``,
      `for {let offset := 0} lt(offset, tailOffset) { offset := add(offset, 32) } {`,
      [`let cdPtr := ${cdPtrItem}`, `mstore(add(mPtrHead, offset), ${decodeFn}(cdPtr))`],
      `}`
    ],
    `}`
  ];
  ctx.addFunction(fnName, code);
  return fnName;
}

export function abiDecodingFunctionArray(ctx: DecoderContext, type: ArrayType): string {
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
