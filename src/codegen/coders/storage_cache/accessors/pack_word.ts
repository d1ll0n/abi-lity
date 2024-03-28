import { StoragePosition } from "../../../../analysis/solidity_storage_positions";
import { StructuredText, addCommaSeparators, writeNestedStructure } from "../../../../utils";
import { ParameterLocation } from "./types";
import { yulAlignValue } from "./utils";

// @todo handle signed integers
export function packWord(positions: StoragePosition[]): StructuredText {
  const aligned: StructuredText[] = positions.map((p) =>
    yulAlignValue(p.label, p.bitsLength, p.type.leftAligned, p.parentOffsetBytes * 8)
  );
  while (aligned.length > 1) {
    const next = aligned.splice(0, 2);
    aligned.unshift([`or(`, addCommaSeparators(next), `)`]);
  }
  return writeNestedStructure(aligned);
}
