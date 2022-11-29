import _ from "lodash";

export type StructuredText<T = string> = Array<StructuredText<T>> | T[] | T;

export const withSpaceOrNull = (str?: string | boolean | null): string =>
  str && typeof str === "string" ? ` ${str}` : "";

export function writeNestedStructure(doc: StructuredText): string {
  if (typeof doc === "string") return doc;
  const ret: string[] = [];
  const doMap = (subArr: StructuredText<string>, depth = 0) => {
    if (subArr == null || subArr === undefined || (typeof subArr === "boolean" && !subArr)) return;
    if (Array.isArray(subArr)) for (const x of subArr) doMap(x, depth + 1);
    else if (typeof subArr === "string") {
      if (subArr.length > 0) ret.push(`${"  ".repeat(depth)}${subArr}`);
      else ret.push("");
    }
  };
  for (const x of doc) doMap(x);
  if (ret[ret.length - 1] === "" || ret[ret.length - 1] === "\n") ret.pop();
  return ret.join(`\n`);
}

type TypicalTextModification = {
  type: "set" | "prefix" | "suffix";
  text: string;
};
type CallbackTextModification = {
  type: "callback";
  cb: TextModificationCallback;
};

export type TextModificationCallback = (text: string) => StructuredText | undefined;

export type TextModification = TypicalTextModification | CallbackTextModification;

export type ModificationType = TextModification["type"];

export type StructuredTextModification = TextModification & {
  position: "first" | "last";
};

const modifyString = (
  original: string,
  modification: TextModification
): StructuredText | undefined => {
  if (modification.type === "callback") {
    return modification.cb(original);
  }
  const { type, text } = modification;
  if (type === "set") return text;
  if (type === "prefix") return text.concat(original);
  // suffix
  return original.concat(text);
};

export const modifyItem = <T extends StructuredText>(
  arrOrStr: T,
  modification: StructuredTextModification
): T => {
  const { position, ...TextModification } = modification;
  if (typeof arrOrStr === "string") {
    return modifyString(arrOrStr, TextModification) as T;
  }
  const index = position === "first" ? 0 : arrOrStr.length - 1;
  const lastItem = arrOrStr[index];
  const modified = modifyItem(lastItem, modification);
  // If item is a string, update the array
  if (typeof modified === "string") {
    arrOrStr[index] = modified;
  } else if (modified === undefined) {
    arrOrStr.splice(index, 1);
  }
  return arrOrStr;
};

type SearchPredicate = StructuredText | ((text: StructuredText) => boolean) | RegExp;

const _searchAndReplace = (
  text: StructuredText,
  findFn: (text: StructuredText) => boolean,
  replaceFn: (text: StructuredText) => StructuredText | undefined
): StructuredText | undefined => {
  if (typeof text === "string") {
    return findFn(text) ? replaceFn(text) : text;
  }
  for (let i = 0; i < text.length; i++) {
    if (findFn(text[i])) {
      const result = [replaceFn(text[i])].filter((x) => x !== undefined);
      text.splice(i, 1, ...(result as StructuredText));
    } else if (Array.isArray(text[i])) {
      _searchAndReplace(text[i], findFn, replaceFn);
    }
  }
  return text;
};

export const searchAndReplace = (
  text: StructuredText,
  findPredicate: SearchPredicate,
  replacePredicate: StructuredText | ((text: StructuredText) => StructuredText)
): StructuredText | undefined => {
  const findFn =
    typeof findPredicate === "function"
      ? findPredicate
      : findPredicate instanceof RegExp
      ? (text: StructuredText) => (typeof text === "string" ? findPredicate.test(text) : false)
      : (text: StructuredText) => _.isEqual(text, findPredicate);
  const replaceFn =
    typeof replacePredicate === "function"
      ? replacePredicate
      : (text: StructuredText) => replacePredicate;
  return _searchAndReplace(text, findFn, replaceFn);
};
// export const searchAndReplace = (text: StructuredText, predicate: string | )

export const setFirstString = <T extends StructuredText>(arrOrStr: T, text: string): T =>
  modifyItem(arrOrStr, { position: "first", type: "set", text });

export const prefixFirstString = <T extends StructuredText>(arrOrStr: T, text: string): T =>
  modifyItem(arrOrStr, { position: "first", type: "prefix", text });

export const suffixFirstString = <T extends StructuredText>(arrOrStr: T, text: string): T =>
  modifyItem(arrOrStr, { position: "first", type: "suffix", text });

export const setLastString = <T extends StructuredText>(arrOrStr: T, text: string): T =>
  modifyItem(arrOrStr, { position: "last", type: "set", text });

export const prefixLastString = <T extends StructuredText>(arrOrStr: T, text: string): T =>
  modifyItem(arrOrStr, { position: "last", type: "prefix", text });

export const suffixLastString = <T extends StructuredText>(arrOrStr: T, text: string): T =>
  modifyItem(arrOrStr, { position: "last", type: "suffix", text });

export const modifyFirstString = <T extends StructuredText>(
  arrOrStr: T,
  cb: TextModificationCallback
): T => modifyItem(arrOrStr, { position: "first", type: "callback", cb });

export const modifyLastString = <T extends StructuredText>(
  arrOrStr: T,
  cb: TextModificationCallback
): T => modifyItem(arrOrStr, { position: "last", type: "callback", cb });

export const removeTrailingNewLines = <T extends StructuredText>(arrOrStr: T): T =>
  modifyLastString(arrOrStr, (str: string) => (str === "" ? undefined : str));

export const addCommaSeparators = <T extends StructuredText[]>(doc: T): T => {
  for (let i = 0; i < doc.length - 1; i++) {
    doc[i] = suffixLastString(doc[i], ",");
  }
  return doc;
};

export const addSeparators = <T extends StructuredText[]>(doc: T, separator: string): T => {
  for (let i = 0; i < doc.length - 1; i++) {
    doc[i] = suffixLastString(doc[i], separator);
  }
  return doc;
};

export const hasSomeMembers = (doc: StructuredText): boolean => {
  if (typeof doc === "string") return true;
  return doc.some(hasSomeMembers);
};

export const coerceArray = <T>(doc: T | T[]): T[] => (Array.isArray(doc) ? doc : [doc]);

/**
 * Wrap the structured text @doc such that @l is in the beginning
 * and @r is at the end. If @doc is a string, returns the string
 * `${l}${doc}${r}`. Otherwise, prefixes the first string in the
 * nested structure of @doc with @l and suffixes the last string
 * with @r
 *
 * If @coerce is true, @l and @r will be added even if @doc does
 * not contain any string.
 * If @addElements is true, @l and @r will be inserted into @doc
 * as elements if @doc is an array, rather than added to the first
 * and last strings.
 */
export const wrap = (
  doc: StructuredText,
  l: string,
  r: string,
  // return wrap components even if array is empty
  coerce?: boolean,
  // adds wrap as new items instead of prefix/suffix
  addElements?: boolean,
  // adds wrap as new level above the current array so that the
  // existing elements become indented
  indent?: boolean
): StructuredText => {
  if (coerce && !hasSomeMembers(doc)) {
    return l.concat(r);
  }
  if (addElements) {
    doc = coerceArray(doc);
    if (indent) {
      doc = [l, doc, r];
    } else {
      doc.unshift(l);
      doc.push(r);
    }
  } else {
    doc = prefixFirstString(doc, l);
    doc = suffixLastString(doc, r);
  }
  return doc;
};

export const wrapParentheses = (
  doc: StructuredText,
  coerce?: boolean,
  addElements?: boolean,
  indent?: boolean
): StructuredText => wrap(doc, "(", ")", coerce, addElements, indent);

export const wrapBraces = (
  doc: StructuredText,
  coerce?: boolean,
  addElements?: boolean,
  indent?: boolean
): StructuredText => wrap(doc, "{", "}", coerce, addElements, indent);

export const wrapBrackets = (
  doc: StructuredText,
  coerce?: boolean,
  addElements?: boolean,
  indent?: boolean
): StructuredText => wrap(doc, "[", "]", coerce, addElements, indent);
