/**
 * @module command_line/commands/inspection
 *
 * Aggregates the inspection subcommands: ir, selectors, and size.
 * Note: An `abi` command exists in this directory but is entirely commented
 * out and not included in the command list.
 */
import * as ir from "./ir";
import * as selectors from "./selectors";
import * as size from "./size";

const commands = [ir, selectors, size];

export default commands;
