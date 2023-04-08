import { StructuredText, toHex } from "../../utils";
import { ArrayType, BytesType, StructType, TypeNode } from "../../ast";
import { abiEncodingFunction } from "./abi_encode";
import {
  CodegenContext,
  getCalldataDecodingFunction,
  roundUpAdd32,
  canCombineTailCopies,
  canDeriveSizeInOneStep,
  getEncodingFunction
} from "../utils";
import NameGen from "../names";
import { assert } from "solc-typed-ast";
import { getMemberDataOffset } from "../offsets";
import { EncodingScheme } from "../../constants";

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
 * Generates an ABI encoding function for an array with a dynamic base type
 * where the tails can be combined into a single copy, assuming strict encoding,
 * which is checked.
 */
function abiEncodingFunctionArrayCombinedDynamicTail(ctx: CodegenContext, type: ArrayType): string {
  if (!canDeriveSizeInOneStep(type.baseType)) {
    throw Error(
      `Can not derive size in one step for ${type.canonicalName} - ${type.baseType.maxNestedDynamicTypes} dynamic ${type.baseType.maxNestedReferenceTypes} reference`
    );
  }
  const fnName = NameGen.abiEncode(type);
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
 * Generates an ABI encoding function for an array of fixed-size reference types
 * that can be combined into a single copy (no embedded reference types).
 */
function abiEncodingFunctionArrayCombinedStaticTail(ctx: CodegenContext, type: ArrayType): string {
  const fnName = NameGen.abiEncode(type);
  if (ctx.hasFunction(fnName)) return fnName;
  const tailSizeName =
    type.baseType.memoryDataSize === 32
      ? "OneWord"
      : ctx.addConstant(
          `${type.baseType.identifier}_mem_tail_size`,
          toHex(type.baseType.memoryDataSize as number)
        );

  const body: StructuredText[] = [];
  let inPtr = "srcLength";
  let outPtr = "dstLength";
  let setSizeStatement: StructuredText[] = [
    `unchecked {`,
    [`size = OneWord + (length * ${tailSizeName});`],
    `}`
  ];

  if (type.isDynamicallySized) {
    body.push(
      `/// Read length of the array from source and write to destination.`,
      `uint256 length = srcLength.readUint256();`,
      `dstLength.write(length);`,
      "",
      `/// Get pointer to first item's head position in the array, containing`,
      `/// the item's pointer in memory. The head pointer will be incremented`,
      `/// until it reaches the tail position (start of the array data).`,
      `MemoryPointer srcHead = srcLength.next();`,
      `MemoryPointer srcHeadEnd = srcHead.offset(length * OneWord);`,
      "",
      `/// Position in memory to write next item. Since ${type.baseType.identifier} has`,
      `/// a fixed size, the array elements do not contain offsets when ABI`,
      `/// encoded, they are concatenated together after the array length.`,
      `MemoryPointer dstHead = dstLength.next();`
    );
  } else {
    inPtr = "srcHead";
    outPtr = "dstHead";
    body.push(`MemoryPointer srcHeadEnd = srcHead.offset(${toHex(32 * (type.length as number))});`);

    const encodedSizeExpression = ctx.addConstant(
      `${type.identifier}_encoded_size`,
      toHex(type.calldataEncodedSize as number)
    );
    setSizeStatement = [`size = ${encodedSizeExpression};`];
  }
  body.push(
    `while (srcHead.lt(srcHeadEnd)) {`,
    [
      `MemoryPointer srcTail = srcHead.pptr();`,
      `srcTail.copy(dstHead, ${tailSizeName});`,
      `srcHead = srcHead.next();`,
      `dstHead = dstHead.offset(${tailSizeName});`
    ],
    `}`,
    ...setSizeStatement
  );

  const code = getEncodingFunction(fnName, inPtr, outPtr, body);
  ctx.addFunction(fnName, code);
  return fnName;
}

/**
 * Generates an ABI encoding function for an array of value types.
 */
function abiEncodingFunctionValueArray(ctx: CodegenContext, type: ArrayType) {
  assert(
    type.baseType.isValueType,
    `Can not make value-array encoding function for array of ${type.baseType.identifier}`
  );
  const fnName = NameGen.abiEncode(type);
  const inner: StructuredText[] = [];
  let inPtr = "srcLength";
  let outPtr = "dstLength";
  if (type.isDynamicallySized) {
    inner.push(
      `uint256 length = srcLength.readUint256();`,
      `unchecked {`,
      [`size = (length + 1) * 32;`],
      `}`
    );
  } else {
    inPtr = "src";
    outPtr = "dst";
    inner.push(`size = ${toHex(type.calldataHeadSize)};`);
  }
  return getEncodingFunction(fnName, inPtr, outPtr, [...inner, `${inPtr}.copy(${outPtr}, size);`]);
}

/**
 * Generates an ABI encoding function for an array of reference types which can not
 * be combined into a single copy, i.e. those with embedded reference types.
 */
function abiEncodingFunctionArraySeparateTail(ctx: CodegenContext, type: ArrayType) {
  const typeName = type.identifier;
  const fnName = NameGen.abiDecode(type);
  if (ctx.hasFunction(fnName)) return fnName;
  let inPtr = "srcLength";
  let outPtr = "dstLength";
  const body: StructuredText[] = [];
  let tailOffset = "tailOffset";
  const decodeFn = abiEncodingFunction(ctx, type.baseType);
  const srcPtrItem = getMemberDataOffset(ctx, "srcPtrHead", type, EncodingScheme.SolidityMemory);
  //  type.baseType.isDynamicallyEncoded
  // ? `cdPtrHead.pptr(offset)`
  // : `cdPtrHead.offset(offset)`;

  /*
  size = 32;
  
      /// Read length of the array from source and write to destination.
      uint256 length = srcLength.readUint256();
      dstLength.write(length);

      /// Relative offset to tail of the array, which contains the data segment of
      /// the first element. Updated after encoding each element so the next element's
      /// head has the correct offset.
      uint256 tailOffset = length * OneWord;

      /// Get pointer to first item's head position in the array, containing
      /// the item's pointer in memory. The head pointer will be incremented
      /// until it reaches the tail position (start of the array data).
      MemoryPointer srcHead = srcLength.next();
      MemoryPointer srcHeadEnd = srcHead.offset(tailOffset);

      /// Position in memory to write next item's offset. Since ${type.baseType.identifier} has
      /// a fixed size, the array elements do not contain offsets when ABI
      /// encoded, they are concatenated together after the array length.
      MemoryPointer dstHead = dstLength.next();

      /// Position in memory to write next item.
      Memory dstTail = dstHead.offset(tailOffset);

      while (srcHead.lt(srcHeadEnd)) {
        /// Get pointer to item from the array head in memory.
        MemoryPointer srcTail = srcHead.pptr();

        /// Encode the item into the array tail and get its encoded size.
        uint256 itemSize = ${baseEncoderFunction}(srcTail, dstTail);

        /// Update total size of the array and the tail offset for the next item.
        size += itemSize;
        tailOffset += itemSize;

        /// Update the position for the next item's tail.
        dstTail = dstTail.offset(tailOffset);

        /// Increment head position of next source and dest item.
        srcHead = srcHead.next();
        dstHead = dstHead.next();
      }

  */

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
        [`tailOffset = `, `mPtrHead.offset(offset).write(${decodeFn}(${cdPtrItem}));`],
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
