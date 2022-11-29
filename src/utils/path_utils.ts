import path from "path";
import { existsSync, mkdirSync } from "fs";

export function getCommonBasePath(_paths: string[]): string | undefined {
  const paths = _paths.map((s) => path.parse(s).dir);
  paths.sort((a, b) => a.length - b.length);
  const length = paths[0].length;
  paths.forEach((p, i) => {
    paths[i] = p.slice(0, length);
  });
  if (!paths.every((p) => p === paths[0])) {
    return undefined;
  }
  return paths[0];
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
