import { assert } from "solc-typed-ast";
import { StructType } from "../ast";
import { StructuredText, toHex } from "../utils";

function getHuffHelpers(type: StructType) {
  const constants = [];
  const macros = [];
  const members = type.vMembers;
  const addConstant = (name: string, value: number | string) => {
    name = name.toUpperCase()
    constants.push(
      `#define constant ${name} = ${
        typeof value === "number" ? toHex(value) : value
      };`
    );
    return name
  }
   
  const addMacro = (name: string, body: StructuredText) => {
    name = name.toUpperCase()
    macros.push("", `#define macro ${name} = {`, body, "}");
    return name
  }

  for (const member of members) {
    const size = member.exactBits;
    assert(size !== undefined, "member size is undefined " + member.labelFromParent);
    const name = member.labelFromParent;
    assert(name !== undefined, "member name is undefined " + member.labelFromParent);
    const offset = Math.ceil(size / 8);
    addConstant(`${name}_offset`, toHex(offset));
    const zeroBytesInWord = 32 - (offset % 32);
    if (zeroBytesInWord !== 32) {
      addConstant(`${name}_zero_bytes_in_word`, toHex(zeroBytesInWord));
    }

    }
    const constant = `#define constant  = ${size};`;
    const macro = `#define macro READ_${name.toUpperCase()} = ${size};`;
  }
}
