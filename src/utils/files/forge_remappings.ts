import path from "path";
import toml from "toml";
import fs, { existsSync } from "fs";
import { coerceArray, deepFindIn, getFilesAndRemappings } from "solc-typed-ast";
import { getAllFilesInDirectory, getCommonBasePath, isDirectory } from "./path_utils";
const findUpSync = require("findup-sync");

function stripTrailingSlash(str: string): string {
  return str.replace(/\/*$/g, "");
}

export type ResolvedSolidityFiles = {
  /** List of file names provided by the caller */
  fileName: string | string[];
  /**
   * Map from file-names (either passed in by caller, or source unit names of imported files)
   * to the contents of the respective files.
   */
  files: Map<string, string>;
  /** List of filesystem remappings */
  remapping: string[];
  /** List of source names in `files`. Used to track original files. */
  sourceNames: string[];
  /** Map from source names in `files` to actual resolved paths on disk (if any). */
  resolvedFileNames: Map<string, string>;
  /** longest path shared by all sources */
  basePath?: string;
};

export function getForgeRemappings(currentDir: string): string[] {
  const remappings = new Map<string, string>();
  const foundryPath = findUpSync("foundry.toml", { cwd: currentDir });
  if (!foundryPath) return [];
  const remappingsPath = findUpSync("remappings.txt", { cwd: currentDir });

  const foundryToml = toml.parse(fs.readFileSync(foundryPath, { encoding: "utf8" }));
  const [tomlRemappings] = deepFindIn(foundryToml, "remappings");
  if (tomlRemappings) {
    tomlRemappings.map((r: string) => {
      const remapping = r.split("=");
      if (remapping.length !== 2) return;
      const [alias, subpath] = remapping.map(stripTrailingSlash);
      const libPath = path.isAbsolute(subpath) ? subpath : path.join(foundryPath, "..", subpath);
      if (!fs.existsSync(libPath)) return;
      remappings.set(alias, libPath);
    });
  }

  const lib = path.resolve(foundryPath, "../lib");
  if (fs.existsSync(lib) && fs.statSync(lib).isDirectory()) {
    fs.readdirSync(lib).forEach((libraryName: string) => {
      libraryName = stripTrailingSlash(libraryName);
      const libPath = path.join(lib, libraryName);
      if (!fs.statSync(libPath).isDirectory()) return;
      if (!remappings.get(libraryName)) {
        remappings.set(libraryName, libPath);
      }
    });
  }
  if (remappingsPath) {
    fs.readFileSync(remappingsPath, { encoding: "utf8" })
      .split("\n")
      .forEach((r: string) => {
        const remapping = r.split("=");
        if (remapping.length !== 2) return;
        const [alias, subpath] = remapping.map(stripTrailingSlash);
        const libPath = path.isAbsolute(subpath)
          ? subpath
          : path.join(remappingsPath, "..", subpath);
        if (!fs.existsSync(libPath)) return;
        if (!remappings.get(alias)) {
          remappings.set(alias, libPath);
        }
      });
  }
  return [...remappings.entries()].map(([key, value]) => `${key}=${value}`);
}

export function resolveSolidityFiles(
  fileNames: string | string[],
  basePath?: string
): ResolvedSolidityFiles {
  fileNames = coerceArray(fileNames);
  const includePath: string[] = [];
  if (basePath) {
    let parent = path.dirname(basePath);
    while (parent !== path.dirname(parent)) {
      includePath.push(parent);
      parent = path.dirname(parent);
    }
  }
  const remappings = getForgeRemappings(basePath as string);
  const { files, remapping, resolvedFileNames } = getFilesAndRemappings(fileNames, {
    basePath,
    includePath,
    remapping: remappings
  });
  const sourceNames = [...files.keys()];
  // If any of the sources are above the base path, reset the base
  // path to be the first common ancestor of all sources.
  if (
    basePath &&
    sourceNames.some(
      (p) => path.isAbsolute(p) && path.relative(basePath as string, p).startsWith("..")
    )
  ) {
    const commonPath = getCommonBasePath(sourceNames);
    basePath = commonPath ? path.normalize(commonPath) : basePath;
  }
  return {
    fileName: fileNames,
    files,
    remapping,
    sourceNames,
    resolvedFileNames,
    basePath
  };
}

export function resolveSolidityFilesOrDirectory(
  input: string,
  allowDirectory?: boolean
): ResolvedSolidityFiles {
  if (
    !path.isAbsolute(input) ||
    (!allowDirectory && path.extname(input) !== ".sol") ||
    !existsSync(input)
  ) {
    throw Error(`${input} is not a Solidity file or was not found.`);
  }
  let fileName: string | string[];
  let basePath: string;
  if (allowDirectory && isDirectory(input)) {
    fileName = getAllFilesInDirectory(input, ".sol");
    basePath = input;
  } else {
    fileName = path.parse(input).base;
    basePath = path.dirname(input);
  }
  return resolveSolidityFiles(fileName, basePath);
}
