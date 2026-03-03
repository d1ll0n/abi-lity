import { TextDecoder, TextEncoder } from "util";
import { getAddress } from "@ethersproject/address";
import { getOffsetYulExpression } from "../codegen/offsets";
import { yulBuiltins } from "solc-typed-ast";

/**
 * Converts a number or bigint to a 0x-prefixed hex string.
 * Values that are exactly 20 bytes long are checksummed as Ethereum addresses
 * to avoid Solidity compiler errors.
 */
export const toHex = (n: number | bigint): string => {
  let bytes = n.toString(16);
  bytes = `0x${"0".repeat(bytes.length % 2)}${bytes}`;
  // Any hex value with 20 bytes and which contains letters is interpreted
  // as an address by Solidity and will cause a compiler error if it is not
  // in checksum format.
  if (bytes.length === 42) {
    return getAddress(bytes);
  }
  return bytes;
};

/** Returns `true` if the value is zero (works with number, bigint, or string). */
export const isZero = (n?: number | bigint | string): boolean =>
  n !== undefined && n.toString() === "0";

export const BI_ONE = BigInt(1);
export const BI_TWO = BigInt(2);

/** Returns the maximum unsigned integer value for the given bit width as a bigint. */
export const maxUint = (bits: number): bigint => 2n ** BigInt(bits) - 1n;

/** Returns the maximum unsigned integer for `bits` as a 0x-prefixed hex string, zero-padded to 32 bytes. */
export const getMaxUint = (bits: number): string =>
  `0x${maxUint(bits).toString(16).padStart(64, "0")}`;

const getOmitMask = (size: number, offset: number) => {
  const bitsAfterStart = 256 - offset;
  const bitsAfter = bitsAfterStart - size;
  let mask = maxUint(offset) << BigInt(bitsAfterStart);
  mask |= maxUint(bitsAfter);
  return mask;
};

/**
 * Returns a 256-bit bitmask that zeros out `size` bits starting at `offset` from the MSB.
 * Used for clearing a field within a packed storage word.
 */
export const getOmissionMask = (size: number, offset: number): string => {
  return toHex(getOmitMask(size, offset));
};

/**
 * Returns a 256-bit bitmask that isolates `bits` bits at the given `offset` from the MSB.
 * Complement of {@link getOmissionMask}: this keeps only the target field.
 */
export const getInclusionMask = (bits: number, offset = 256 - bits): string => {
  const bitsAfterStart = 256 - offset;
  const bitsAfter = bitsAfterStart - bits;
  return toHex(maxUint(bits) << BigInt(bitsAfter));
};

/** Returns the minimum number of bits needed to represent `n`. If `roundUp`, rounds to the next byte boundary. */
export const bitsRequired = (n: number, roundUp?: boolean): number => {
  const a = Math.ceil(Math.log2(n + 1));
  return roundUp && a % 8 ? a + (8 - (a % 8)) : a;
};

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i !== bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Encodes a UTF-8 string as a hex string (no 0x prefix). */
export const utf8ToHex = (str: string): string => bytesToHex(new TextEncoder().encode(str));

/** Decodes a hex string (no 0x prefix) to a UTF-8 string. */
export const hexToUtf8 = (str: string): string => new TextDecoder().decode(hexToBytes(str));

/** Type guard that returns `true` if `value` is a number or a decimal/hex numeric string. */
export const isNumeric = <T = any>(value: number | string | T): value is number | string =>
  typeof value === "number" || (typeof value === "string" && !!value.match(/^(0x)?[0-9a-fA-F]+$/));
