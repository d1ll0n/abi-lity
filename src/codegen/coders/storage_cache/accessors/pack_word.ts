import { StoragePosition } from "../../../../analysis/storage_positions";
import { StructuredText, addCommaSeparators, writeNestedStructure } from "../../../../utils";
import { alignValue } from "./utils";

export function packWord(positions: StoragePosition[]): StructuredText {
  const aligned: StructuredText[] = positions.map((p) =>
    alignValue(p.label, p.bytesLength * 8, p.type.leftAligned, p.parentOffsetBytes * 8)
  );
  while (aligned.length > 1) {
    const next = aligned.splice(0, 2);
    aligned.unshift([`or(`, addCommaSeparators(next), `)`]);
  }
  return writeNestedStructure(aligned);
}
