**Source: libsolidity/ast/Types.cpp**

ArrayType:

- offset
- length
- mpos
- slot

ArraySliceType:

- offset
- length

ContractType:

- address

StructType:

- offset
- mpos
- slot

TupleType:

- "component\_" + number

FunctionType:

- address
- functionSelector
- functionIdentifier
- gas
- value
- salt
- self

MappingType:

- slot

TypeType:

- address
