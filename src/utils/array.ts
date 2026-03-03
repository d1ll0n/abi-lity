import { findIndex, findLastIndex, List, ListIterateeCustom } from "lodash";

/** A value that may be a single element or an array of elements. */
export type MaybeArray<T> = T | T[];

/** Returns the last element of a non-empty array. */
export const last = <T>(arr: T[]): T => arr[arr.length - 1];

/** Returns a `[firstIndex, lastIndex]` tuple of the first and last elements matching `predicate`. */
export const findFirstAndLastIndex = <T>(
  array: List<T> | null | undefined,
  predicate?: ListIterateeCustom<T, boolean>,
  fromIndex?: number
): [number, number] => {
  return [findIndex(array, predicate, fromIndex), findLastIndex(array, predicate, fromIndex)];
};

/** Returns the slice of `array` from the first to the last element matching `predicate` (inclusive). */
export const getInclusiveRangeWith = <T>(
  array: T[] | null | undefined,
  predicate?: ListIterateeCustom<T, boolean>,
  fromIndex?: number
): T[] => {
  if (!array) return [];
  const [start, end] = findFirstAndLastIndex(array, predicate, fromIndex);
  if (start < 0) return [];
  return array.slice(start, end + 1);
};

/** Sums an array of numbers, returning `undefined` if any element is `undefined`. */
export const sumOrUndefined = (arr: Array<number | undefined>): number | undefined =>
  arr.reduce((sum, n) => (sum === undefined || n === undefined ? undefined : sum + n), 0);
