import * as assert_eq from "./assert_eq";
import * as forge_json from "./forge_json";
import * as json from "./json";
import * as generate_coders from "./generate_coders";
import * as iface from "./iface";
import * as pointer_libs from "./pointer_libs";
import * as wrappers from "./wrappers";
import * as ctype from "./ctype";

const commands = [
  assert_eq,
  ctype,
  forge_json,
  json,
  iface,
  generate_coders,
  pointer_libs,
  wrappers
];

export default commands;
