// import { DataLocation } from "solc-typed-ast";
import { TypeNode } from "../../../ast";
import { DataLocation } from "../../../constants";
import { toHex } from "../../../utils";

function moveData(type: TypeNode, ref: string, src: DataLocation, dst: DataLocation) {
  const parent = type.parent!;
  // Reading from stack value can not occur on values that don't fit into a word.
  if (src === DataLocation.Stack && (parent.exactBits === undefined || parent.exactBits > 256)) {
    throw Error("Unsupported type!");
  }

  if (dst === DataLocation.Calldata || dst === DataLocation.Returndata) {
    throw Error(`Unsupported destination ${dst}!`);
  }

  if (src === DataLocation.Returndata) {
    if (dst === DataLocation.Stack) {
      const offset = type.exactBitsOffset / 8;
      const size = Math.ceil(type.exactBits! / 8) * 8;
      return [`returndatacopy(0, add(${ref}, ${toHex(offset)}), ${toHex(size)})`, `mload(0)`];
    }
    if (dst === DataLocation.Memory) {
      const offset = type.exactBitsOffset / 8;
      const size = Math.ceil(type.exactBits! / 8) * 8;
      return [`returndatacopy(${ref}, add(${ref}, ${toHex(offset)}), ${toHex(size)})`];
    }
  }
  if (src === DataLocation.Calldata) {
    if (dst === DataLocation.Stack) {
      const offset = type.exactBitsOffset / 8;
      const size = Math.ceil(type.exactBits! / 8) * 8;
      return [`calldatacopy(0, add(${ref}, ${toHex(offset)}), ${toHex(size)})`, `mload(0)`];
    }
    if (dst === DataLocation.Memory) {
      const offset = type.exactBitsOffset / 8;
      const size = Math.ceil(type.exactBits! / 8) * 8;
      return [`calldatacopy(${ref}, add(${ref}, ${toHex(offset)}), ${toHex(size)})`];
    }
  }
  if (src === DataLocation.Memory) {
    if (dst === DataLocation.Stack) {
      const offset = type.exactBitsOffset / 8;
      const size = Math.ceil(type.exactBits! / 8) * 8;
      return [`0.offset(${toHex(offset)}).copy(${ref}, ${toHex(size)});`];
    }
  }
}
