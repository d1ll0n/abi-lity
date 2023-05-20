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
    console.log(files.get(key as string));
    writeFileSync(path.join(__dirname, "debug.sol"), files.get(key as string) as string);
  }
  throw new CompileFailedError([{ compilerVersion: compiler.version, errors }]);
}

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
  const compiler = await getCompilerForVersion(version!, CompilerKind.Native);
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

export type CompilerOpts = {
  outputs?: CompilationOutput[];
  settings?: any;
  version?: string;
};

export function getCompileOptions(opts?: CompilerOpts): CompilerOpts {
  const outputs: CompilationOutput[] = opts?.outputs ?? [CompilationOutput.AST];
  const settings = opts?.settings ?? {
    optimizer: { enabled: false },
    viaIR: false,
    metadata: { bytecodeHash: "none" }
  };

  return { settings, outputs, version: opts?.version ?? LatestCompilerVersion };
}

export type ContractOutput = {
  abi: JsonFragment[];
  creationCode: string;
  runtimeCode: string;
  irOptimized: string;
  ir: string;
  generatedSources?: any;
  sourceMap?: string;
  functionDebugData?: any;
};

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

export const CompilerOutputConfigs = {
  // Config for copy tests that need bytecode & abi
  TESTS: [CompilationOutput.ABI, CompilationOutput.AST, "evm.deployedBytecode.object" as any],
  IR: ["ir" as any, CompilationOutput.AST],
  IR_OPTIMIZED: ["irOptimized" as any, CompilationOutput.AST],
  CODEGEN: [CompilationOutput.AST]
};

// Compiler options given by API consumer (e.g. cli, fn that triggers a compile)
export type UserCompilerOptions = {
  metadata?: boolean;
  viaIR?: boolean;
  optimizer?: boolean;
  runs?: number | "max";
  debug?: {
    debugInfo?: ["*"];
  };
};

// Compiler options that can be passed to solc
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
