import { TextDecoder, TextEncoder } from "util";
import { getAddress } from "@ethersproject/address";

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

export const isZero = (n?: number | bigint | string): boolean =>
  n !== undefined && n.toString() === "0";

export const BI_ONE = BigInt(1);
export const BI_TWO = BigInt(2);
export const maxUint = (bits: number): bigint => 2n ** BigInt(bits) - 1n;

export const getMaxUint = (bits: number): string =>
  `0x${maxUint(bits).toString(16).padStart(64, "0")}`;

const getOmitMask = (offset: number, size: number) => {
  const bitsAfterStart = 256 - offset;
  const bitsAfter = bitsAfterStart - size;
  let mask = maxUint(offset) << BigInt(bitsAfterStart);
  mask |= maxUint(bitsAfter);
  return mask;
};

export const getOmissionMask = (bitsBefore: number, size: number): string => {
  return toHex(getOmitMask(bitsBefore, size));
};

export const getInclusionMask = (bits: number): string => toHex(maxUint(bits));

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

export const utf8ToHex = (str: string): string => bytesToHex(new TextEncoder().encode(str));

export const hexToUtf8 = (str: string): string => new TextDecoder().decode(hexToBytes(str));

export const isNumeric = <T = any>(value: number | string | T): value is number | string =>
  typeof value === "number" || (typeof value === "string" && !!value.match(/^(0x)?[0-9a-fA-F]+$/));
