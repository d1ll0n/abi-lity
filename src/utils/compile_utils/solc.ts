/**
 * Low-level Solidity compilation interface.
 *
 * Wraps solc-typed-ast's `compileSync` with error detection, compiler option
 * presets, and async compiler acquisition. Defines the {@link ContractOutput}
 * type used throughout the codebase for bytecode/ABI/IR access.
 */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  CompilationOutput,
  CompileFailedError,
  compileSync,
  detectCompileErrors,
  WasmCompiler,
  NativeCompiler,
  LatestCompilerVersion,
  assert,
  getCompilerForVersion,
  CompilerKind
} from "solc-typed-ast";
import { JsonFragment } from "@ethersproject/abi";
import { writeFileSync } from "fs";
import path from "path";

/** Synchronously compiles source files with the given compiler, throwing on errors. */
export function compile(
  compiler: WasmCompiler | NativeCompiler,
  files: Map<string, string>,
  remapping: string[],
  compilationOutput: CompilationOutput[] = CompilerOutputs,
  compilerSettings?: any
): any {
  const data = compileSync(compiler, files, remapping, compilationOutput, compilerSettings);
  const errors = detectCompileErrors(data);
  if (errors.length === 0) {
    Object.assign(data, { files });
    return data;
  }
  console.log(errors);
  const key = [...files.keys()].find((k) => k.includes("CopierWithSwitch"));
  if (key) {
    // console.log(files.get(key as string));
    writeFileSync(path.join(__dirname, "debug.sol"), files.get(key as string) as string);
  }
  throw new CompileFailedError([{ compilerVersion: compiler.version, errors }]);
}

/** Asynchronously acquires the WASM compiler and compiles the given files. */
export async function compileAsync(
  files: Map<string, string>,
  remapping: string[],
  options?: CompilerOpts
): Promise<{
  output: any;
  compiler: WasmCompiler | NativeCompiler;
  options: CompilerOpts;
}> {
  const { settings, outputs, version } = getCompileOptions(options);
  const compiler = await getCompilerForVersion(version!, CompilerKind.WASM);
  assert(compiler !== undefined, `Compiler not found for ${version}`);

  return {
    output: compile(compiler, files, remapping, outputs, settings),
    compiler,
    options: {
      settings,
      outputs,
      version
    }
  };
}

/** Internal compiler options: output selections, solc settings JSON, and compiler version. */
export type CompilerOpts = {
  outputs?: CompilationOutput[];
  settings?: any;
  version?: string;
};

/** Returns resolved compiler options with defaults (AST output, optimizer off, latest version). */
export function getCompileOptions(opts?: CompilerOpts): CompilerOpts {
  const outputs: CompilationOutput[] = opts?.outputs ?? [CompilationOutput.AST];
  const settings = opts?.settings ?? {
    optimizer: { enabled: false },
    viaIR: false,
    metadata: { bytecodeHash: "none" }
  };

  return { settings, outputs, version: opts?.version ?? LatestCompilerVersion };
}

/** Structured output for a single compiled contract (ABI, bytecode, IR, debug info). */
export type ContractOutput = {
  abi: JsonFragment[];
  creationCode: string;
  runtimeCode: string;
  irOptimized: string;
  irOptimizedAst?: any;
  assembly?: string;
  ir: string;
  irAst?: any;
  generatedSources?: any;
  sourceMap?: string;
  functionDebugData?: any;
};

/** Default full set of compiler output selections (ABI, bytecode, IR, source maps). */
export const CompilerOutputs = [
  CompilationOutput.ABI,
  CompilationOutput.AST,
  "evm.deployedBytecode.object" as any,
  CompilationOutput.EVM_BYTECODE_OBJECT,
  "irOptimized" as any,
  "ir" as any,
  "evm.deployedBytecode.functionDebugData" as any,
  "evm.deployedBytecode.sourceMap" as any
];

/** Predefined compiler output presets for different use cases. */
export const CompilerOutputConfigs = {
  // Config for copy tests that need bytecode & abi
  TESTS: [CompilationOutput.ABI, CompilationOutput.AST, "evm.deployedBytecode.object" as any],
  IR: ["ir" as any, CompilationOutput.AST],
  IR_OPTIMIZED: ["irOptimized" as any, CompilationOutput.AST],
  CODEGEN: [CompilationOutput.AST],
  ABI: [CompilationOutput.ABI, CompilationOutput.AST],
  IR_TRACE: [
    CompilationOutput.EVM_ASSEMBLY,
    CompilationOutput.IR,
    CompilationOutput.IR_AST,
    CompilationOutput.AST,
    CompilationOutput.IR_OPTIMIZED,
    CompilationOutput.IR_OPTIMIZED_AST
  ]
};

/** User-facing compiler options (simplified from solc settings). */
export type UserCompilerOptions = {
  metadata?: boolean;
  viaIR?: boolean;
  optimizer?: boolean;
  runs?: number | "max";
  debug?: {
    debugInfo?: ["*"];
  };
  extraOutputSelection?: CompilationOutput[];
};

/** Solc-compatible compiler settings object. */
export type CompilerOptions = {
  metadata?: { bytecodeHash: "none" };
  viaIR?: boolean;
  optimizer?: {
    enabled?: boolean;
    runs?: number;
  };
  runs?: number | "max";
  debug?: {
    debugInfo?: ["*"];
  };
};

/** Merges user-facing options with defaults (optimized or unoptimized presets). */
export const getCompilerOptionsWithDefaults = (
  optionOverrides?: UserCompilerOptions
): CompilerOptions => {
  const defaultOptions =
    DefaultCompilerOptions[optionOverrides?.optimizer ? "optimized" : "unoptimized"];
  return parseCompilerOptions({
    ...defaultOptions,
    ...optionOverrides
  });
};

function parseCompilerOptions(options: UserCompilerOptions): CompilerOptions {
  const { metadata, viaIR, optimizer, runs, debug } = options;
  const opts: CompilerOptions = {
    viaIR,
    optimizer: {
      enabled: optimizer || Boolean(runs),
      runs: runs === "max" ? 4_294_967_295 : runs
    },
    debug
  };
  if (!metadata) opts.metadata = { bytecodeHash: "none" };
  return opts;
}
const DefaultCompilerOptions = {
  get optimized(): UserCompilerOptions {
    return {
      ...DefaultCompilerOptions.unoptimized,
      optimizer: true,
      runs: "max"
    };
  },
  get unoptimized(): UserCompilerOptions {
    return {
      viaIR: true,
      metadata: false,
      debug: {
        debugInfo: ["*"]
      }
    };
  }
};
