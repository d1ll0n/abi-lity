/**
 * Bundled Solidity library code.
 *
 * Stores pre-written Solidity libraries as JSON arrays of lines. Each getter
 * function loads and joins the lines to produce source code strings. Libraries include:
 * - `PointerLibraries` — CalldataPointer/MemoryPointer types and methods
 * - `ScuffDirectives` — Fuzzing/testing helpers for corrupting ABI data
 * - `ForgeTestShim` — forge-std Test contract shim for standalone test generation
 * - `VmShim` — forge-std Vm interface shim
 * - `JsonLib` / `LibJson` — JSON serialization helpers
 */
import { writeNestedStructure } from "../../utils";

/** Returns the ScuffDirectives Solidity source code for ABI data fuzzing. */
export const getScuffDirectives = (): string => require("./ScuffDirectives.json").join("\n");

export const getPointerLibraries = (): string => require("./PointerLibraries.json").join("\n");

export const getSTDAssertionsShim = (): string => require("./STDAssertionsShim.json").join("\n");

export const getVMShim = (): string => require("./VmShim.json").join("\n");

export const getJsonLib = (): string => require("./JsonLib.json").join("\n");

export const getLibJson = (): string => require("./LibJson.json").join("\n");

export const getForgeTestShim = (): string => require("./ForgeTestShim.json").join("\n");

/** Lazy-loaded map of all bundled Solidity library source code, keyed by library name. */
export const SolidityLibraries = {
  get ScuffDirectives(): string {
    return getScuffDirectives();
  },
  get PointerLibraries(): string {
    return getPointerLibraries();
  },
  get STDAssertionsShim(): string {
    return getSTDAssertionsShim();
  },
  get VmShim(): string {
    return getVMShim();
  },
  get JsonLib(): string {
    return getJsonLib();
  },
  get ForgeTestShim(): string {
    return getForgeTestShim();
  }
};

/** Replaces the VmShim import with a direct forge-std import for production builds. */
export function removeVmShim(files: Map<string, string>, primaryFilePath: string): void {
  const newCode = writeNestedStructure([
    `import { Vm } from "forge-std/Vm.sol";`,
    "",
    `address constant VM_ADDRESS = address(`,
    [`uint160(uint256(keccak256("hevm cheat code")))`],
    `);`,
    `Vm constant vm = Vm(VM_ADDRESS);`
  ]);
  const code = files.get(primaryFilePath) as string;
  files.clear();
  files.set(primaryFilePath, code.replace(`import "./Temp___Vm.sol";`, newCode));
}

/** Replaces the ForgeTestShim import with a direct forge-std import for production builds. */
export function removeForgeTestShim(files: Map<string, string>, primaryFilePath: string): void {
  const newCode = writeNestedStructure([`import { Test } from "forge-std/Test.sol";`]);
  const code = files.get(primaryFilePath) as string;
  files.clear();
  files.set(primaryFilePath, code.replace(`import "./Temp___Test.sol";`, newCode));
}
