import { assert } from "solc-typed-ast";
import { StructuredText, toHex } from "../../utils";
import { ArrayType } from "../../ast";
import { abiEncodingFunction } from "./abi_encode";
import { CodegenContext, getEncodingFunction } from "../utils";
import NameGen from "../names";

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
function abiEncodingFunctionValueArray(ctx: CodegenContext, type: ArrayType): string {
  assert(
    type.baseType.isValueType,
    `Can not make value-array encoding function for array of ${type.baseType.identifier}`
  );
  const fnName = NameGen.abiEncode(type);
  if (ctx.hasFunction(fnName)) return fnName;
  const inner: StructuredText[] = [];
  let inPtr = "srcLength";
  let outPtr = "dstLength";
  if (type.isDynamicallySized) {
    inner.push(
      `uint256 length = srcLength.readUint256();`,
      `unchecked {`,
      [`size = (length + 1) << OneWordShift;`],
      `}`
    );
  } else {
    inPtr = "src";
    outPtr = "dst";
    inner.push(`size = ${toHex(type.calldataHeadSize)};`);
  }
  const code = getEncodingFunction(fnName, inPtr, outPtr, [
    ...inner,
    `${inPtr}.copy(${outPtr}, size);`
  ]);
  ctx.addFunction(fnName, code);
  return fnName;
}

/**
 * Generates an ABI encoding function for an array of reference types which can not
 * be combined into a single copy, i.e. those with embedded reference types.
 */
function abiEncodingFunctionArraySeparateTail(ctx: CodegenContext, type: ArrayType): string {
  const typeName = type.identifier;
  const fnName = NameGen.abiDecode(type);
  if (ctx.hasFunction(fnName)) return fnName;
  let inPtr = "srcLength";
  let outPtr = "dstLength";
  const body: StructuredText[] = [];
  const decodeFn = abiEncodingFunction(ctx, type.baseType);

  if (type.isDynamicallySized) {
    body.push(
      `unchecked {`,
      [
        `/// Read length of the array from source and write to destination.`,
        `uint256 length = srcLength.readUint256();`,
        `dstLength.write(length);`,
        "",
        `/// Get pointer to head of first element, which contains a pointer to its data.`,
        `MemoryPointer srcHead = srcLength.next();`,
        "",
        `/// Position in memory to write next item's offset. Since ${type.baseType.identifier} has`,
        `/// a dynamic size, the array elements contain offsets relative to the start of the head.`,
        `MemoryPointer dstHead = dstLength.next();`,
        "",
        `uint256 headOffset;`,
        `uint256 headSize = length << OneWordShift;`,
        `size = headSize;`,
        "",
        `while (headOffset < headSize) {`,
        [
          `/// Write tail offset to the array head.`,
          `dstHead.offset(headOffset).write(size);`,
          "",
          `/// Encode the item into the array tail and get its encoded size.`,
          `uint256 itemSize = ${decodeFn}(srcHead.pptr(headOffset), dstHead.offset(size));`,
          "",
          `/// Update total size of the array and the head offset for the next item.`,
          `size += itemSize;`,
          `headOffset += OneWord;`
        ],
        `}`,
        `size += 32;`
      ],
      `}`
      // [
      //   `uint256 length = srcLength.readUint256();`,
      //   `uint256 tailOffset = length * OneWord;`,
      //   `dstLength = malloc(tailOffset + 32);`,
      //   `dstLength.write(length);`,
      //   `size = tailOffset + 32;`,
      //   `MemoryPointer dstHead = dstLength.next();`,
      //   `MemoryPointer srcHead = srcLength.next();`,
      //   `MemoryPointer srcHeadEnd = srcHead.offset(tailOffset);`,
      //   ``,
      //   `for (uint256 offset; offset < tailOffset; offset += 32) {`,
      //   [`dstHead.write(tailOffset);`, `dstTail``dstHead = dstHead.next();`][
      //     `dstHead.offset(offset).write(${decodeFn}(${cdPtrItem}));`
      //   ],
      //   `}`
      // ],
    );
  } else {
    inPtr = "srcHead";
    outPtr = "dstHead";
    const headSize = ctx.addConstant(
      `${typeName}_memory_head_size`,
      toHex(type.embeddedMemoryHeadSize)
    );
    body.push(
      `uint256 headOffset;`,
      `size = ${headSize};`,
      "",
      `while (headOffset < ${headSize}) {`,
      [
        `/// Write tail offset to the array head.`,
        `dstHead.offset(headOffset).write(size);`,
        "",
        `/// Encode the item into the array tail and add its encoded size to total size.`,
        `size += ${decodeFn}(srcHead.pptr(headOffset), dstHead.offset(size));`,
        "",
        `/// Update head offset for the next item.`,
        `headOffset += OneWord;`
      ],
      `}`
    );
  }

  const code = getEncodingFunction(fnName, inPtr, outPtr, body);

  ctx.addFunction(fnName, code);
  return fnName;
}

export function abiEncodingFunctionArray(ctx: CodegenContext, type: ArrayType): string {
  if (type.baseType.isValueType) {
    return abiEncodingFunctionValueArray(ctx, type);
  }
  if (type.baseType.isDynamicallyEncoded) {
    return abiEncodingFunctionArraySeparateTail(ctx, type);
  }
  return abiEncodingFunctionArrayCombinedStaticTail(ctx, type);
}
