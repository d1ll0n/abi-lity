/**
 * @module command_line/commands/index
 *
 * Command aggregator that collects all CLI commands from the three command
 * groups (codegen, inspection, test) and registers them with yargs.
 *
 * Note: This file is a near-duplicate of the parent `commands.ts` — both
 * aggregate the same command groups with different relative import paths.
 */

import { Argv } from "yargs";
import codegen from "./codegen";
import inspection from "./inspection";
import test from "./test";

const commands = [...codegen, ...inspection, ...test];

/** Registers all CLI commands onto the given yargs instance by reducing over the command list. */
export const addCommands = <T>(yargs: Argv<T>): Argv<T> =>
  commands.reduce((yargs, cmd) => cmd.addCommand(yargs), yargs);
