import path from "path";
import { StructuredText, writeNestedStructure } from "../../utils";
import { readFileSync, writeFileSync } from "fs";

function extractStructure(code: string) {
  const lines = code.split("\n");
  const takeAtIndentation = (indent: number) => {
    // console.log(`Taking at indentation: ${indent}`);
    const result: StructuredText[] = [];

    while (lines.length > 0) {
      const line = lines[0];
      const [, lnIndent] = line.match(/^(\s*)/) ?? [];
      if (lnIndent === undefined || lnIndent.length < indent) {
        break;
      }
      if (lnIndent.length > indent) {
        result.push(takeAtIndentation(lnIndent.length));
      } else {
        result.push(lines.shift()?.slice(indent) as string);
      }
    }
    return result;
  };
  const [, lnIndent, rest] = lines[0].match(/^(\s*)(.*)/) ?? [];
  if (lnIndent === undefined || rest === undefined) {
    throw new Error("Could not get indent of first line");
  }
  return takeAtIndentation(lnIndent.length);
}

function writeSolToStructuredJson(name: string) {
  const oldFilePath = path.join(__dirname, `${name}.sol`);
  const newFilePath = path.join(__dirname, `${name}.json`);
  const code = readFileSync(oldFilePath, "utf8");
  const structure = extractStructure(code);
  writeFileSync(newFilePath, JSON.stringify(structure, null, 2));
}

function writeSolToLinesJson(name: string) {
  const oldFilePath = path.join(__dirname, `${name}.sol`);
  const newFilePath = path.join(__dirname, `${name}.json`);
  const code = readFileSync(oldFilePath, "utf8");
  const lines = code.split("\n");
  writeFileSync(newFilePath, JSON.stringify(lines, null, 2));
}

writeSolToLinesJson("JsonLib");

/* const code = `
  function foo() {
    function bar() {
      return 1;
    }
    return 2;
  }
`; */
// console.log(someFile(code));
// writeSolToJson("PointerLibraries");
// writeFileSync(
//   path.join(__dirname, "PointerLibraries.sol"),
//   require("./PointerLibraries.json").join("\n")
// );
