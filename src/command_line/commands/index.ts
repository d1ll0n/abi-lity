import { Argv } from "yargs";
import codegen from "./codegen";
import inspection from "./inspection";
import test from "./test";

const commands = [...codegen, ...inspection, ...test];

export const addCommands = <T>(yargs: Argv<T>): Argv<T> =>
  commands.reduce((yargs, cmd) => cmd.addCommand(yargs), yargs);
