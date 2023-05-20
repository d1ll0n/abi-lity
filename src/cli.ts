#!/usr/bin/env node
import yargs from "yargs";
import { addCommands } from "./command_line/commands";

const ts = Date.now();
addCommands(yargs)
  .help("h")
  .alias("h", "help")

  .fail(function (msg, err) {
    if (msg) {
      console.error(msg);
    }
    if (err?.message) {
      console.error(err.message);
    }
    throw err;
  })
  .parseAsync()
  .then(() => {
    console.log(`Done in ${Date.now() - ts}ms`);
  });
