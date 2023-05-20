import { writeFileSync } from "fs";
import { StructuredText, writeNestedStructure } from "../src";
import path from "path";

const allElementaryTypesForReaders = ["Bool", "Address"];

const FixedBytes = [
  "Bytes1",
  "Bytes2",
  "Bytes3",
  "Bytes4",
  "Bytes5",
  "Bytes6",
  "Bytes7",
  "Bytes8",
  "Bytes9",
  "Bytes10",
  "Bytes11",
  "Bytes12",
  "Bytes13",
  "Bytes14",
  "Bytes15",
  "Bytes16",
  "Bytes17",
  "Bytes18",
  "Bytes19",
  "Bytes20",
  "Bytes21",
  "Bytes22",
  "Bytes23",
  "Bytes24",
  "Bytes25",
  "Bytes26",
  "Bytes27",
  "Bytes28",
  "Bytes29",
  "Bytes30",
  "Bytes31",
  "Bytes32"
];

const Integers = [
  "Int8",
  "Int16",
  "Int24",
  "Int32",
  "Int40",
  "Int48",
  "Int56",
  "Int64",
  "Int72",
  "Int80",
  "Int88",
  "Int96",
  "Int104",
  "Int112",
  "Int120",
  "Int128",
  "Int136",
  "Int144",
  "Int152",
  "Int160",
  "Int168",
  "Int176",
  "Int184",
  "Int192",
  "Int200",
  "Int208",
  "Int216",
  "Int224",
  "Int232",
  "Int240",
  "Int248",
  "Int256"
];
const UnsignedIntegers = [
  "Uint8",
  "Uint16",
  "Uint24",
  "Uint32",
  "Uint40",
  "Uint48",
  "Uint56",
  "Uint64",
  "Uint72",
  "Uint80",
  "Uint88",
  "Uint96",
  "Uint104",
  "Uint112",
  "Uint120",
  "Uint128",
  "Uint136",
  "Uint144",
  "Uint152",
  "Uint160",
  "Uint168",
  "Uint176",
  "Uint184",
  "Uint192",
  "Uint200",
  "Uint208",
  "Uint216",
  "Uint224",
  "Uint232",
  "Uint240",
  "Uint248",
  "Uint256"
];

const AllTypes = [...allElementaryTypesForReaders, ...FixedBytes, ...Integers, ...UnsignedIntegers];

function generateArrayCasts() {
  const casts = [] as StructuredText[];
  for (const _type of AllTypes) {
    casts.push(
      `function toPointer(${_type.toLowerCase()}[] memory arr) internal pure returns (MemoryPointer ptr) {`,
      [`assembly { ptr := arr }`],
      `}`,
      ""
    );
  }

  const code = [`library ArrayCasts {`, casts, `}`];

  writeFileSync(path.join(__dirname, "ArrayCasts.sol"), writeNestedStructure(code));
}

generateArrayCasts();
