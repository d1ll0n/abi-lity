import { assert } from "solc-typed-ast";
import {
  yulExtractByte,
  pickBestCodeForPreferences,
  yulShiftAndMask,
  yulShiftTwice
} from "./utils";
import { ReadParameterArgs } from "./types";

/**
 * Generates multiple Yul code options for reading a field from a packed stack value.
 * Strategies include byte extraction, shift+mask, and double-shift.
 */
export function getOptionsReadFromStack(
  args: Omit<ReadParameterArgs, "bytesLength" | "bytesOffset">
): string[] {
  const options: string[] = [];

  assert(
    args.bitsOffset + args.bitsLength <= 256,
    [
      `Can not generate stack offset for parameter that overflows word:`,
      `\n\t${args.bitsOffset} + ${args.bitsLength} > 256`
    ].join("")
  );

  if (args.bitsLength === 256) return [args.dataReference];

  // Option 1. Single byte is extracted
  if (args.bitsLength === 8) options.push(yulExtractByte(args));

  // Option 2. shift and mask - fn skips unnecessary ops
  options.push(yulShiftAndMask(args));

  // Option 3. shift twice - fn skips unnecessary ops
  options.push(yulShiftTwice(args));

  return options;
}

/** Selects the most efficient Yul code for reading a field from a packed stack value. */
export function getReadFromStackAccessor(
  args: Omit<ReadParameterArgs, "bytesLength" | "bytesOffset">
): string {
  const options = getOptionsReadFromStack(args);

  return pickBestCodeForPreferences(
    options,
    args.gasToCodePreferenceRatio,
    args.defaultSelectionForSameScore
  );
}
