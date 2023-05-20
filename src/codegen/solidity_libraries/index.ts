export const getScuffDirectives = (): string => require("./ScuffDirectives.json").join("\n");

export const getPointerLibraries = (): string => require("./PointerLibraries.json").join("\n");

export const getSTDAssertionsShim = (): string => require("./STDAssertionsShim.json").join("\n");

export const getVMShim = (): string => require("./VmShim.json").join("\n");
