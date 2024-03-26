import { yulBuiltins } from "solc-typed-ast";
import { getInclusionMask, getOmissionMask, toHex } from "../../../../utils";
import { ParameterLocation, ReadParameterArgs } from "./types";

// Returns a Yul expression that masks out the bits from `offset` to `offset + bitsLength`
export const maskOmit = (value: string, bitsLength: number, offset: number): string =>
  `and(${value}, ${getOmissionMask(bitsLength, offset)})`;

// Returns a Yul expression that only includes the bits from `offset` to `offset + bitsLength`
export const maskInclude = (value: string, bitsLength: number, offset: number): string => {
  if (offset === 0 && bitsLength === 256) return value;
  return `and(${value}, ${getInclusionMask(bitsLength, offset)})`;
};

export function isNumeric(n: string | number): boolean {
  if (typeof n === "number") return true;
  return /^-?\d+$/.test(n) || n.startsWith("0x");
}

export const shiftAndMask = ({
  dataReference,
  offset,
  leftAligned,
  bytesLength
}: ParameterLocation): string => {
  const bitsLength = bytesLength * 8;
  const bitsOffset = offset * 8;
  const endOfFieldBitsOffset = bitsOffset + bitsLength;
  // For left aligned values, mask then shift left
  if (leftAligned) {
    const rhs =
      endOfFieldBitsOffset === 256
        ? dataReference
        : maskInclude(dataReference, bitsLength, bitsOffset);
    return yulShl(bitsOffset, rhs);
  }
  // For right aligned values, shift right then mask
  const bitsBeforeAfterShift = 256 - bitsLength;
  const bitsAfter = 256 - endOfFieldBitsOffset;
  if (bitsOffset === 0) {
    return yulShr(bitsAfter, dataReference);
  }
  return maskInclude(yulShr(bitsAfter, dataReference), bitsLength, bitsBeforeAfterShift);
};

export const extractByte = ({ dataReference, offset, leftAligned }: ParameterLocation): string => {
  const byteExpr = `byte(${offset}, ${dataReference})`;
  return leftAligned ? yulShl(248, byteExpr) : byteExpr;
};

export const shiftTwice = ({
  dataReference,
  offset,
  leftAligned,
  bytesLength
}: ParameterLocation): string => {
  const bitsLength = bytesLength * 8;
  const bitsOffset = offset * 8;
  const endOfFieldBitsOffset = bitsOffset + bitsLength;
  // For left aligned values, shift right then left
  if (leftAligned) {
    const bitsAfter = 256 - endOfFieldBitsOffset;
    const bitsBeforeAfterShift = 256 - bitsLength;
    return yulShl(bitsBeforeAfterShift, yulShr(bitsAfter, dataReference));
  }
  // For right aligned values, shift left then right
  const bitsAfterAfterShift = 256 - bitsLength;
  return yulShr(bitsAfterAfterShift, yulShl(bitsOffset, dataReference));
};

export const isNotNumeric = (n: string | number): n is string => !isNumeric(n);
export const isZero = (n: string | number): boolean => isNumeric(n) && BigInt(n) === 0n;
export const toValue = (n: string | number): string => (isNotNumeric(n) ? n : toHex(BigInt(n)));

export const yulShl = (bits: number, value: string | number): string => {
  if (isNotNumeric(value)) {
    return bits === 0 ? value : `shl(${toHex(bits)}, ${value})`;
  }
  return toHex(BigInt(value) << BigInt(bits));
};

export const yulShr = (bits: number, value: string | number): string => {
  if (isNotNumeric(value)) {
    return bits === 0 ? value : `shr(${toHex(bits)}, ${value})`;
  }
  return toHex(BigInt(value) >> BigInt(bits));
};

export const yulAdd = (a: string | number, b: string | number): string | number => {
  if (isNumeric(a) && isNumeric(b)) {
    return toHex(BigInt(a) + BigInt(b));
  }
  if (isZero(a)) return b;
  if (isZero(b)) return a;
  return `add(${toValue(a)}, ${toValue(b)})`;
};

export const alignStackValue = (
  valueExpr: string | number,
  valueOffset: number,
  targetOffset: number
): string => {
  const shift = targetOffset - valueOffset;
  return (shift > 0 ? yulShr : yulShl)(Math.abs(shift), valueExpr);
};

/* const extractValueFromWord = (
  word: string,
  bitsLength: number,
  valueOffset: number,
  targetOffset: number,
  mustBeClean: boolean
) => {
  const endOfCurrentValue = valueOffset + bitsLength;
  const endOfTargetValue = targetOffset + bitsLength;
  const leftDirtyBits = valueOffset > 0 && targetOffset > 0;
  const rightDirtyBits = endOfCurrentValue < 256 && endOfTargetValue < 256;

}; */

export const alignValue = (
  valueExpr: string | number,
  bitsLength: number,
  leftAligned: boolean,
  targetOffset: number
): string => {
  const currentOffset = leftAligned ? 0 : 256 - bitsLength;
  const shift = targetOffset - currentOffset;
  // if (shift === 0) return valueExpr;
  return (shift > 0 ? yulShr : yulShl)(Math.abs(shift), valueExpr);
};

// The gas to code preference ratio is the amount of gas that must be saved to add 1 byte of code.
// Example:
// Willing to add up to 1 byte of code per 3 gas saved
// So to score the options, we multiply the bytes by 3 and add the gas
// 4 bytes, 6 gas -> 18
// 2 bytes, 9 gas -> 15
// 10 bytes, 3 gas -> 33
// The option with the lowest score is the best option. If there is a tie, the option with the
// lowest value for the given default preference is selected.
export function pickBestCodeForPreferences(
  options: string[],
  gasToCodePreferenceRatio = 3,
  defaultSelectionForSameScore: "leastgas" | "leastcode" = "leastgas"
): string {
  const optionCosts = options.map((code) => ({ code, ...measureGasAndSize(code) }));
  optionCosts.sort((a, b) => {
    const aScore = a.gas + a.bytes * gasToCodePreferenceRatio;
    const bScore = b.gas + b.bytes * gasToCodePreferenceRatio;
    if (aScore === bScore) {
      if (defaultSelectionForSameScore === "leastgas") {
        return a.gas - b.gas;
      } else {
        return a.bytes - b.bytes;
      }
    }
    return aScore - bScore;
  });
  return optionCosts[0].code;
}

// Assumes all instructions are 3 gas
export function measureGasAndSize(code: string): { gas: number; bytes: number } {
  const lines = code.split("\n");
  const startingPosition = { gas: 0, bytes: 0 };
  const codeToMeasure: string[] = [];
  for (const line of lines) {
    if (line.includes(":=")) {
      // Line has variable assignment. Assuming the assignment is used in the remaining
      // lines, each identifier will be counted as 3 gas (for a dup) and 1 byte.
      // Since the assignment is part of the measured code, we should calculate the cost
      // of the assigned value and then subtract one byte and 3 gas from the total, as
      // the last identifier will probably use the value rather than dup it.
      const [, value] = line.split(":=");
      const cost = measureGasAndSize(value);
      startingPosition.gas += cost.gas - 3;
      startingPosition.bytes += cost.bytes - 1;
    } else {
      codeToMeasure.push(line);
    }
  }
  const ops = codeToMeasure
    .join(",")
    .replace(/\s/g, "")
    .split(/,|\(|\)/g)
    .filter((x) => x !== "");
  const yulInstructions = [...yulBuiltins.members.keys()];
  // Should this handle PUSH0?
  return ops.reduce(
    (acc, curr) => {
      if (curr.startsWith("0x")) {
        // Push instruction - uses 1 + size of data bytes
        const size = curr.length / 2; // don't sub 1 for 0x because of the PUSHN opcode
        acc.bytes += size;
        acc.gas += 3;
      } else if (yulInstructions.includes(curr)) {
        acc.gas += 3;
        acc.bytes += 1;
      } else if (/^-?\d+$/.test(curr)) {
        // Push instruction - uses 1 + size of data bytes
        const hexValue = toHex(BigInt(curr));
        const size = hexValue.length / 2; // don't sub 1 for 0x because of the PUSHN opcode
        acc.bytes += size;
        acc.gas += 3;
      } else {
        // Assume it is some identifier that will resolve to a dup
        acc.bytes += 1;
        acc.gas += 3;
      }
      return acc;
    },
    { gas: 0, bytes: 0 }
  );
}
