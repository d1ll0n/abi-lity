import path from "path";
import { existsSync, mkdirSync } from "fs";

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

export const getDirectory = (_path: string): string =>
  path.parse(_path).ext ? path.parse(_path).dir : _path;

const recursiveMkDirIfNotExists = (target: string) => {
  if (!target) return undefined;
  if (!existsSync(target)) {
    const parent = path.parse(target).dir;
    if (!recursiveMkDirIfNotExists(parent)) {
      return undefined;
    }
    mkdirSync(target);
  }
  return target;
};

export const mkdirIfNotExists = (target: string): string => {
  const targetDir = getDirectory(toAbsolutePath(target));
  if (!recursiveMkDirIfNotExists(targetDir)) {
    throw Error(`Failed to resolve existing parent directory for ${target}`);
  }
  return targetDir;
};

export const toAbsolutePath = (target: string): string =>
  path.isAbsolute(target) ? target : path.join(process.cwd(), target);

export const getRelativePath = (from: string, to: string): string => {
  let relative = path.relative(from, to);
  if (!relative.startsWith("../")) relative = `./${relative}`;
  return relative;
};
