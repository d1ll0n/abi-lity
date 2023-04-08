import { BytesType, StructType, TupleType } from "../ast";

// @todo define specific expressions
type OffsetExpression = number | string;

type RelativeDestination = {
  type: "relative";
  pointer: string;
  offset: OffsetExpression;
};

type AbsoluteDestination = {
  type: "absolute";
  pointer: string;
};

type TypeCodec = {
  [key: string]: {};
};

/*
Language:

Type System
- value types
- arrays
- structs
- tuples
- buffers


Variable Declaration


- read type 

*/

class SomeCodec {
  static tuple(type: TupleType): void {}
  static struct(type: StructType): void {}
  static bytes(type: BytesType): void {}
}

/*
describe_type_encoding()
(uint a, uint[] b, bytes c)
[0x00:0x20] = a
[0x20:0x40] = 0x60
[0x40:0x60] = 0x80 + b_tail_size
[0x60:0x80] = b.length
[0x80:0x80+b_tail_size] = ...b


b_tail_size = b.length * 32
c_tail_size

[
  { type: 'write', from: 0, to: 32, ref: 'a' },
  { type: 'write', from: 32, to: 64,  }
]

{
  a: { from: 0, to: 32 },
  b: {
    head: { from: 32, to: 64 },
    length: { from:  }
  }
}

*/
