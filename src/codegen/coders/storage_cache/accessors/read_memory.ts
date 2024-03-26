import { yulAdd, pickBestCodeForPreferences } from "./utils";
import { ParameterLocation, ReadParameterArgs } from "./types";
import { getOptionsReadFromStack } from "./read_stack";

export function getReadFromMemoryAccessor(args: ReadParameterArgs): string {
  const options = getOptionsReadFromMemory(args);

  return pickBestCodeForPreferences(
    options,
    args.gasToCodePreferenceRatio,
    args.defaultSelectionForSameScore
  );
}

export function getOptionsReadFromMemory(args: ParameterLocation): string[] {
  if (args.bytesLength === 32) {
    return [`mload(${yulAdd(args.dataReference, args.offset)})`];
  }
  return [
    ...getOptionsReadFromMemoryInFirstWord(args),
    ...getOptionsReadFromMemoryAtStartOfWord(args),
    ...getOptionsReadFromMemoryAtEndOfWord(args)
  ];
}

function getOptionsReadFromMemoryAtStartOfWord({
  dataReference,
  offset,
  bytesLength,
  leftAligned
}: ParameterLocation) {
  const readExpr = `mload(${yulAdd(dataReference, offset)})`;
  const args = {
    offset: 0,
    bytesLength,
    dataReference: readExpr,
    leftAligned
  };
  return getOptionsReadFromStack(args);
}

/**
 * Get options for reading a value from memory by mload'ing
 * 32 bytes before the end of the value. Requires the field
 * end at least 32 bytes from `dataReference` to not underflow,
 * as solc's optimizer does not play nice with subtraction.
 */
export function getOptionsReadFromMemoryAtEndOfWord({
  dataReference,
  offset,
  bytesLength,
  leftAligned
}: ReadParameterArgs): string[] {
  const endOfFieldOffset = offset + bytesLength;
  if (endOfFieldOffset < 32) {
    return [];
  }
  const readExpr = `mload(${yulAdd(dataReference, endOfFieldOffset - 32)})`;
  const args = {
    offset: 32 - bytesLength,
    bytesLength,
    dataReference: readExpr,
    leftAligned
  };
  return getOptionsReadFromStack(args);
}

function getOptionsReadFromMemoryInFirstWord(args: ParameterLocation) {
  const endOfFieldOffset = args.offset + args.bytesLength;
  if (endOfFieldOffset > 32) {
    return [];
  }
  const readExpr = `mload(${args.dataReference})`;
  return getOptionsReadFromStack({
    ...args,
    dataReference: readExpr
  });
}
