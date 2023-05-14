import { Argv } from "yargs";
import codegen from "./commands/codegen";
import inspection from "./commands/inspection";
import test from "./commands/test";

const commands = [...codegen, ...inspection, ...test];

export const addCommands = <T>(yargs: Argv<T>): Argv<T> =>
  commands.reduce((yargs, cmd) => cmd.addCommand(yargs), yargs);
