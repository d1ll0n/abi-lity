import { assert } from "solc-typed-ast";
import {
  yulExtractByte,
  pickBestCodeForPreferences,
  yulShiftAndMask,
  yulShiftTwice,
  yulShl
} from "./utils";
import { ReadParameterArgs } from "./types";

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

  if (args.bitsLength === 256) {
    return [args.dataReference];
  }

  // Option 1. Single byte is extracted
  if (args.bitsLength === 8) {
    options.push(yulExtractByte(args));
  }

  // Option 2. shift and mask - fn skips unnecessary ops
  options.push(yulShiftAndMask(args));

  // Option 3. shift twice - fn skips unnecessary ops
  options.push(yulShiftTwice(args));

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
