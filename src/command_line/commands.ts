/**
 * @module command_line/commands
 *
 * Top-level command aggregator that collects all CLI commands from the three
 * command groups (codegen, inspection, test) and registers them with yargs.
 *
 * Note: This file is a near-duplicate of `commands/index.ts` — both aggregate
 * the same three command groups but with different import paths. See
 * `notes/dead-code-and-cleanup.md` for details.
 */

import { Argv } from "yargs";
import codegen from "./commands/codegen";
import inspection from "./commands/inspection";
import test from "./commands/test";

const commands = [...codegen, ...inspection, ...test];

/** Registers all CLI commands onto the given yargs instance by reducing over the command list. */
export const addCommands = <T>(yargs: Argv<T>): Argv<T> =>
  commands.reduce((yargs, cmd) => cmd.addCommand(yargs), yargs);
