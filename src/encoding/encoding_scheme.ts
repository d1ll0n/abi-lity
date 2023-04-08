class AbiEncodingScheme {}

/*
uint256[] arr;

1. Copy from calldata and put in memory to be used as calldata at `dst`
arr.copy(dst, (arr.read() + 1) * 32)
2. Copy from calldata and put in memory as a sol array
3. Copy from returndata and put in memory as a sol array
4. Copy from memory to memory to be used as calldata




Two attributes relevant - location and scheme
Examples:
struct ABC {
  uint128 a;
  uint128 b;
}

struct DEF {
  ABC x;
  ABC y;
}

ABI Encoding:
bytes32(a) . bytes32(b) . bytes32(a) . bytes32(b)

Sol Memory:
ptr(x) . ptr(y)
x: bytes32(a) . bytes32(b)
y: bytes32(a) . bytes32(b)

Sol Storage
layout
bytes16(a) . bytes16(b) . bytes16(a) . bytes16(b)

read y.b
sload(1) & mask_16

Read 
*/

/*
uint256[] arr;
length = arr.read()
for ()

Copy:
from: arr.length, arr.length.ptr + arr.length.read() * 32
to: 
*/
