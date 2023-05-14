import { keccak256 } from "@ethersproject/keccak256";
import { toUtf8Bytes } from "@ethersproject/strings";

export type FilesCache = {
  // maps file path to hash of its contents
  [path: string]: string;
};

export function getFilesCache(files: Map<string, string>): FilesCache {
  const cache: FilesCache = {};
  for (const [path, file] of files) {
    cache[path] = keccak256(toUtf8Bytes(file));
  }
  return cache;
}

/**
 * Returns a map of files that were added since the last compilation.
 */
export function getNewFiles(files: Map<string, string>, cache: FilesCache): Map<string, string> {
  const newFiles = new Map<string, string>();
  for (const [path, file] of files) {
    if (!cache[path]) {
      newFiles.set(path, file);
    }
  }
  return newFiles;
}

/**
 * Returns a map of files that were modified since the last compilation.
 * Note that this function does not return files that were not present previously.
 */
export function getModifiedFiles(
  files: Map<string, string>,
  cache: FilesCache
): Map<string, string> {
  const newFiles = new Map<string, string>();
  for (const [path, file] of files) {
    if (cache[path] && cache[path] !== keccak256(toUtf8Bytes(file))) {
      newFiles.set(path, file);
    }
  }
  return newFiles;
}
