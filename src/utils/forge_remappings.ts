import path from "path";
import toml from "toml";
import fs from "fs";
const findUpSync = require("findup-sync");

function stripTrailingSlash(str: string): string {
  return str.replace(/\/*$/g, "");
}

export function getForgeRemappings(currentDir: string): string[] {
  const remappings = new Map<string, string>();
  const foundryPath = findUpSync("foundry.toml", { cwd: currentDir });
  if (!foundryPath) return [];
  const remappingsPath = findUpSync("remappings.txt", { cwd: currentDir });

  const foundryToml = toml.parse(fs.readFileSync(foundryPath, { encoding: "utf8" }));

  if (foundryToml.remappings) {
    foundryToml.remappings.map((r: string) => {
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
