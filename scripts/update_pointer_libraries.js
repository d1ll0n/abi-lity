const path = require("path");
const fs = require("fs");

const pointers = fs.readFileSync(path.join(__dirname, "PointerLibraries.sol"), "utf8");
fs.writeFileSync(
  path.join(__dirname, "../src/codegen/PointerLibraries.json"),
  JSON.stringify(pointers.split("\n"), null, 2)
);
