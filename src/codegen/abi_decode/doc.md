/\*
Goal: Be able to generate coders for arbitrary encoding schemes.

Step 1. Determine how data types map on to each other.

When we're decoding an ABI encoded uint256[] to put into sol memory, we just copy the full buffer.
When we're decoding an ABI encoded struct with a uint256[] however, we first have to

struct ABCD {
uint256 value;
uint256[2] smallArray;
uint256[] bigArray;
}

library ABCD_ABI {
uint256 internal constant value_offset = 0;
uint256 internal constant smallArray_0_offset = 32;
uint256 internal constant smallArray_1_offset = 64;
uint256 internal constant bigArray_head_offset = 96;

}

<!-- Library for each ~~encoding scheme /~~ location should have options like `readLeftPadded` `readRightPadded` `readWord` `readByte` `readBytes` -->

So right now it basically supports one thing, which is transcoding from ABI encoded calldata to solc's memory format. There's also like half an implementation for doing solc memory -> ABI.

The core thing I want to do is make it more generic and location-agnostic; i.e. be able to take a desired translation with `type, sourceEncoding, targetEncoding, location (memory|calldata|returndata|stack)` and generate a transcoding function (or an encode/decode fn if one side is on the stack).

Get ABI Encoded Layout:

// HEAD
// [0:32] = value
// [32:64] = smallArray[0]
// [64:96] = smallArray[1]
// [96:128] = bigArray*
// [bigArray*:bigArray\*+32] = bigArray.length

# STEP 1: GENERATE NAIVE ENCODING FN

```js
function abi_encode_ABCD(ptr, src value, smallArray, bigArray):
  write(ptr, value)
  write(ptr + 32, smallArray[0])
  write(ptr + 64, smallArray[1])

  let tailOffset = 128
  write(ptr + 96, tailOffset)

  let bigArrayDstPtr = ptr + tailOffset
  write(bigArrayDstPtr, bigArray.length)

  for (i in bigArray.length):
    write(bigArrayDstPtr += 32, bigArray[i])
```

# STEP 2: FILL IN DETAILS FOR SOURCE ENCODING

// If it comes from solc memory encoding:

```js
function abi_encode_ABCD_from_solc_memory(ptr, srcPtr):
  write(ptr, read(srcPtr))

  let smallArrayPtr = srcPtr.pptr(32)
  write(ptr + 32, read(smallArrayPtr))
  write(ptr + 64, read(smallArrayPtr + 32))

  let tailOffset = 128
  write(ptr + 96, tailOffset)

  let bigArraySrcPtr = srcPtr.pptr(64)
  let bigArrayDstPtr = ptr + tailOffset
  write(bigArrayDstPtr, read(bigArraySrcPtr))

  for (i in bigArray.length):
    write(bigArrayDstPtr += 32, read(bigArraySrcPtr += 32))
```

# STEP 3: OPTIMIZE READS/WRITES

Suppose we want to resolve bigArray.length
We need to know that this is acquired with readPptr(ABCD, 96)

When encoding the struct, for ABI we'll know that setting a ptr involves writing the offset

Should this support completely arbitrary schemes? What if there are schemes where there is no head and dynamic values can be written anywhere, e.g.

## <!-- I want to turn abi-lity into a generic tool that lets you define any kind of encoding scheme and is able to codegen libraries for encoding/decoding/transcoding (i.e. going from packed ABI encoded calldata to solc memory or what have you) -->

```js
struct SmallData {
  uint16[10] byteArray;
}

type WrittenWord = {
  name: string;
  ref: TypeData;
  // align: 'right' | 'left'
  wordPosition?: {
    /* Default = 0, 256 */
    offset: number;

  }
}

function leftAlignBytes(value, bytes) {

}


function encode_SmallData(ptr, byteArray) {
  /*
  Option 1. For each, shift left, write to ptr to start
  Option 2. Split elements into words with most members, align to position in word, OR together, write once
  Option 3. Do option 2 in optimize stage

  For 3, it'd be better to have some indication of the alignment in the first step

  Unless specified, values are assumed to be right aligned / left padded
  */
  write(ptr, leftAlignBytes(byteArray[0], 2 /* bytes */))
  write(ptr + 2, leftAlignBytes(byteArray[1], 2 /* bytes */))
  ...
}

type WriteCall = {
  ptr: Expression;
  value: Expression
}

function optimizeSubWordWrites(writes) {
  for (write of writes) {
    if (write.value.isCall('leftAlignBytes')) {
      const [srcValue, size] = write.value.params
    }
  }
}

function decode_SmallData(ptr)
```

# Generic Coder Generator

This tool will take as inputs:

1. `schemes` - A set of encoding schemes, as defined below
2. `schemas` - A set of valid ABI types to generate coders for (e.g. structs, calldata tuples, etc.)
   - "valid" can be somewhat loose - e.g. a `uint2` could be specified, and for types which do not support sub-byte sizes, it'd be rounded up to `uint8`
   - Perhaps this could also support completely custom types, so long as there is some way to define what the type would look like in at least one other encoding scheme.
3. `translations` - A set of desired translations between encoding schemes

## Translations

Each translation will specify, for both the source and target:

1. Language - Initially just Solidity, but could add support for other languages like Vyper, Huff, TypeScript, Rust, etc.
2. Data location (if relevant for language) - stack, calldata, memory, storage
   - This could also allow specification of whether the position is relative or absolute
3. Encoding scheme

In practice, the set of desired translations will likely be generated by a code analysis tool which checks how data is already being used in a codebase.

## Encoding Scheme Definition

Encoding schemes will be defined by TypeScript classes which accept type definitions and output code (or AST) describing how to encode and decode the data in a simple language.

Schemes must be able to generate an abstract logical representation of how to encode/decode a particular type, as this could be drastically different for different types.

This language will support functions, arithmetic, bit shift operations, arrays, structs, loops and buffer manipulation.
The buffer being written to / read from is location agnostic. The codegen tool will fill in the details for particular locations.

The scheme must define, for a given type, an encode and a decode function.

The encode function will take as arguments a pointer to the target location to write to (a location-agnostic buffer) as well as an instance of the type to encode.
It may optionally return arbitrary data.

**Syntax**
The syntax used by the abstract coders will include some generic buffer access functions.
Unless otherwise specified, all values are single words.

```js
// =====================================================================//
//                       Buffer Access Functions                        //
// =====================================================================//

/** @dev Write one word `value` to `ptr` in data buffer */
write(ptr, value);
/** @dev Write last `size` bytes of `value` to `ptr` without affecting bytes after this range */
writeBytes(ptr, value, size);
/** @dev Write first `size` bytes of `value` to `ptr` without affecting bytes after this range */
writeBytesLeft(ptr, value, size);

/** @dev Read one word `value` from `ptr` in data buffer */
read(ptr, value);
/** @dev Read last `size` bytes of `value` from `ptr`*/
readBytes(ptr, value, size);
/** @dev Read first `size` bytes of `value` from `ptr`*/
readBytesLeft(ptr, value, size);

/**
 * @dev Align `value` so that its data is `leftOffset` bytes from the left.
 * Will result in different final code depending on the input value
 * e.g. for a left-aligned `bytes1`, it will shift right; for a
 * right-aligned `uint8` it will shift left.
 */
leftAlignBytes(value, leftOffset);
leftAlignBits(value, leftOffset);

rightAlignBytes(value, rightOffset);
rightAlignBits(value, rightOffset);
```

**Example**

```js
struct SomeArrays {
  uint256[2] fixedArray;
  uint256[] dynamicArray;
}
```

For this type, the ABI encoding scheme would produce the following function:

```js
uint256 constant SomeArrays_dynamicArray_offset = 96;

function ABI_encode_dynamic_uint256_array(
  uint256 ptr,
  uint256[] dynamicArray
) returns (uint256 size) {
  write(ptr, dynamicArray.length)
  let offset = 32;
  for (let i in dynamicArray.length; offset += 32) {
    write(ptr + offset, dynamicArray[i])
  }
  return offset;
}
function ABI_encode_length_2_uint256_array(
  uint256 ptr,
  uint256[] dynamicArray
) returns (uint256 size) {
  write(ptr, dynamicArray.length)
  let offset = 32;
  for (let i in dynamicArray.length; offset += 32) {
    write(ptr + offset, dynamicArray[i])
  }
  return offset;
}

function ABI_encode_SomeArrays(
  uint256 ptr,
  uint256[2] fixedArray,
  uint256[] dynamicArray
) returns (uint256 size) {
  write(ptr, fixedArray[0])
  write(ptr + 32, fixedArray[1])

  let tailOffset = SomeArrays_dynamicArray_offset
  write(ptr + 64, tailOffset)
  write(ptr + tailOffset, dynamicArray.length)

  let bigArrayDstPtr = ptr + tailOffset
  write(bigArrayDstPtr, bigArray.length)

  for (i in bigArray.length):
    write(bigArrayDstPtr += 32, bigArray[i])
  for (i in bigArray.length) {

  }
}
```

Rule: Only one level of nested members may be accessed in any expression.

e.g. `SomeArrays.fixedArray` is valid, but `SomeArrays.fixedArray.length` is not.

Once we've generated the basic code for the encoder, we go through every reference to the input type and insert the relevant code for the source type.

Q: Would it be good enough to only support types based on ABI's general framework? i.e. you specify whether heads exist for each type and if they're relative or absolute, and how large each size is when encoded.

`encode` accepts
`(uint256 ptr, ...args)`

should accept a definition for an arbitrary encoding scheme
