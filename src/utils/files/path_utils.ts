/**
 * Path and directory utilities for resolving file locations during compilation.
 */
import path from "path";
import { lstatSync, mkdirSync, readdirSync } from "fs";

/** Returns the longest common directory prefix shared by all paths, or undefined if none. */
export function getCommonBasePath(_paths: string[]): string | undefined {
  const paths = _paths.map((s) => path.parse(s).dir);
  paths.sort((a, b) => a.length - b.length);
  let shortestPath = paths[0];
  while (shortestPath !== path.dirname(shortestPath)) {
    if (paths.every((p) => p.startsWith(shortestPath))) {
      return shortestPath;
    }
    shortestPath = path.dirname(shortestPath);
  }
  return undefined;
}

/** Returns the directory portion of a path (or the path itself if it has no extension). */
export const getDirectory = (_path: string): string =>
  path.parse(_path).ext ? path.parse(_path).dir : _path;

const recursiveMkDirIfNotExists = (target: string) => {
  if (!target) return undefined;
  mkdirSync(target, { recursive: true });
  return target;
};

/** Creates the directory tree for `target` if it doesn't exist, returning the resolved path. */
export const mkdirIfNotExists = (target: string): string => {
  const targetDir = getDirectory(toAbsolutePath(target));
  if (!recursiveMkDirIfNotExists(targetDir)) {
    throw Error(`Failed to resolve existing parent directory for ${target}`);
  }
  return targetDir;
};

export const toAbsolutePath = (target: string): string =>
  path.isAbsolute(target) ? target : path.join(process.cwd(), target);

/** Returns a relative path from `from` to `to`, always prefixed with `./` or `../`. */
export const getRelativePath = (from: string, to: string): string => {
  let relative = path.relative(from, to);
  if (!relative.startsWith("../")) relative = `./${relative}`;
  return relative;
};

export const isDirectory = (_path: string): boolean => lstatSync(_path).isDirectory();

/** Recursively lists all files in a directory, optionally filtered by extension. */
export const getAllFilesInDirectory = (_path: string, ext?: string): string[] => {
  const children = readdirSync(_path);
  const files: string[] = [];
  children.forEach((child) => {
    const filePath = path.join(_path, child);
    if (isDirectory(filePath)) {
      const subChildren = getAllFilesInDirectory(filePath, ext).map((file) =>
        path.join(filePath, file)
      );
      files.push(...subChildren);
    } else if (ext === path.extname(filePath)) {
      files.push(filePath);
    }
  });
  return files.map((file) => getRelativePath(_path, file));
};
