import { findIndex, findLastIndex, List, ListIterateeCustom } from "lodash";

export type MaybeArray<T> = T | T[];

export const last = <T>(arr: T[]): T => arr[arr.length - 1];

export const findFirstAndLastIndex = <T>(
  array: List<T> | null | undefined,
  predicate?: ListIterateeCustom<T, boolean>,
  fromIndex?: number
): [number, number] => {
  return [findIndex(array, predicate, fromIndex), findLastIndex(array, predicate, fromIndex)];
};

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

export const sumOrUndefined = (arr: Array<number | undefined>): number | undefined =>
  arr.reduce((sum, n) => (sum === undefined || n === undefined ? undefined : sum + n), 0);
