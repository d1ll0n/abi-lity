import { StoragePosition } from "../../../../analysis/solidity_storage_positions";
import { StructuredText, addCommaSeparators, writeNestedStructure } from "../../../../utils";
import { yulAlignValue } from "./utils";

/**
 * Generates a Yul expression that packs multiple storage positions into a single 256-bit word
 * by aligning each field to its bit offset and OR-ing them together.
 */
export function packWord(positions: StoragePosition[]): StructuredText {
  const aligned: StructuredText[] = positions.map((p) =>
    yulAlignValue(p.label, p.bitsLength, p.type.leftAligned, p.parentOffsetBits)
  );
  while (aligned.length > 1) {
    const next = aligned.splice(0, 2);
    aligned.unshift([`or(`, addCommaSeparators(next), `)`]);
  }
  return writeNestedStructure(aligned);
}
