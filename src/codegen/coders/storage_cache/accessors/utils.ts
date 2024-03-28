import { yulBuiltins } from "solc-typed-ast";
import { getInclusionMask, getOmissionMask, toHex } from "../../../../utils";
import { ParameterLocation } from "./types";

export type YulValueLike = string | number | bigint;

export const roundUpToNextByte = (bits: number): number => Math.ceil(bits / 8) * 8;
export const roundDownToNextByte = (bits: number): number => Math.floor(bits / 8) * 8;

// Returns a Yul expression that masks out the bits from `offset` to `offset + bitsLength`
export const maskOmit = (value: string, bitsLength: number, offset: number): string =>
  `and(${value}, ${getOmissionMask(bitsLength, offset)})`;

// Returns a Yul expression that only includes the bits from `offset` to `offset + bitsLength`
export const maskInclude = (value: string, bitsLength: number, offset: number): string => {
  if (offset === 0 && bitsLength === 256) return value;
  return `and(${value}, ${getInclusionMask(bitsLength, offset)})`;
};

export function isNumeric(n: YulValueLike): boolean {
  if (typeof n === "number" || typeof n === "bigint") return true;
  return /^-?\d+$/.test(n) || n.startsWith("0x");
}

export const yulShiftAndMask = ({
  dataReference,
  leftAligned,
  bitsLength,
  bitsOffset
}: Pick<
  ParameterLocation,
  "dataReference" | "leftAligned" | "bitsLength" | "bitsOffset"
>): string => {
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

export const yulExtractByte = ({
  dataReference,
  bitsOffset,
  leftAligned
}: Pick<ParameterLocation, "dataReference" | "bitsOffset" | "leftAligned">): string => {
  // If value is rightmost byte in the word but should be left aligned
  // when decoded, shl is the cheapest way to extract it.
  if (leftAligned && bitsOffset === 248) {
    return yulShl(248, dataReference);
  }
  // If value does not begin at a clean byte boundary, we need to extract the byte
  // with shifts.
  if (bitsOffset % 8 !== 0) {
    if (!leftAligned) return `byte(0, ${yulShl(bitsOffset, dataReference)})`;
    return yulShiftTwice({
      dataReference,
      bitsOffset,
      leftAligned,
      bitsLength: 8
    });
  }
  // Otherwise, `byte` will always be the best option (or on par with other options)
  const byteExpr = `byte(${bitsOffset}, ${dataReference})`;
  return yulShiftTo(byteExpr, 248, leftAligned ? 0 : 248);
};

export const yulShiftTwice = ({
  dataReference,
  bitsLength,
  bitsOffset,
  leftAligned
}: Pick<
  ParameterLocation,
  "bitsLength" | "dataReference" | "bitsOffset" | "leftAligned"
>): string => {
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

export const isNotNumeric = (n: YulValueLike): n is string => !isNumeric(n);
export const isZero = (n: YulValueLike): boolean => isNumeric(n) && BigInt(n) === 0n;
export const toValue = (n: YulValueLike): string => (isNotNumeric(n) ? n : toHex(BigInt(n)));

/**
 * Generate a Yul expression that is equivalent to `value << bits`.
 * If `bits` is zero, the value is returned as is.
 * If the value is numeric, the shifted value is returned as a hex string.
 * Otherwise, a Yul `shl` expression is returned.
 */
export const yulShl = (bits: number, value: YulValueLike): string => {
  if (isNotNumeric(value)) {
    return bits === 0 ? value : `shl(${toHex(bits)}, ${value})`;
  }
  return toHex(BigInt(value) << BigInt(bits));
};

/**
 * Generate a Yul expression that is equivalent to `value >> bits`.
 * If `bits` is zero, the value is returned as is.
 * If the value is numeric, the shifted value is returned as a hex string.
 * Otherwise, a Yul `shr` expression is returned.
 */
export const yulShr = (bits: number, value: YulValueLike): string => {
  if (isNotNumeric(value)) {
    return bits === 0 ? value : `shr(${toHex(bits)}, ${value})`;
  }
  return toHex(BigInt(value) >> BigInt(bits));
};

/**
 * Generate a Yul expression that is equivalent to `a + b`.
 * If both values are numeric, the sum is returned as a hex string.
 * If one of the values is zero, the other value is returned.
 * Otherwise, a Yul `add` expression is returned.
 */
export const yulAdd = (a: YulValueLike, b: YulValueLike): string | number => {
  if (isNumeric(a) && isNumeric(b)) {
    return toHex(BigInt(a) + BigInt(b));
  }
  if (isZero(a)) return toValue(b);
  if (isZero(b)) return toValue(a);
  return `add(${toValue(a)}, ${toValue(b)})`;
};

/**
 * Generate a Yul expression that shifts a value to a target offset.
 * If the value is already aligned, it is returned as is.
 * If the target offset is greater than the value offset, returns expression
 *    equivalent to `value >> (targetOffset - valueOffset)`.
 * If the target offset is less than the value offset, returns expression
 *    equivalent to `value << (valueOffset - targetOffset)`.
 */
export const yulShiftTo = (
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

export const yulAlignValue = (
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

// Assumes all instructions are 3 gas.
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
