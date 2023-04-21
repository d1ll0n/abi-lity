#!/usr/bin/env node
import yargs from "yargs";
import { addCommands } from "./command_line/commands";

addCommands(yargs).fail(function (msg, err) {
  if (msg) {
    console.error(msg);
  }
  if (err?.message) {
    console.error(err.message);
  }
  throw err;
}).argv;
