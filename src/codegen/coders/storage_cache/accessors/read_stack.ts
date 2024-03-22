import { assert } from "solc-typed-ast";
import { extractByte, pickBestCodeForPreferences, shiftAndMask, shiftTwice, shl } from "./utils";
import { ReadParameterArgs } from "./types";

export function getOptionsReadFromStack(args: ReadParameterArgs): string[] {
  const options: string[] = [];

  assert(
    args.offset + args.bytesLength <= 32,
    [
      `Can not generate stack offset for parameter that overflows word:`,
      `\n\t${args.offset} + ${args.bytesLength} > 32`
    ].join("")
  );

  if (args.bytesLength === 32) {
    return [args.dataReference];
  }

  // Option 1. Single byte is extracted
  if (args.bytesLength === 1) {
    options.push(extractByte(args));
  }

  // Option 2. shift and mask - fn skips unnecessary ops
  options.push(shiftAndMask(args));

  // Option 3. shift twice - fn skips unnecessary ops
  options.push(shiftTwice(args));

  return options;
}

export function getReadFromStackAccessor(args: ReadParameterArgs): string {
  const options = getOptionsReadFromStack(args);

  return pickBestCodeForPreferences(
    options,
    args.gasToCodePreferenceRatio,
    args.defaultSelectionForSameScore
  );
}
