import {
  assert,
  ASTContext,
  ASTNodeFactory,
  ASTReader,
  ASTWriter,
  CompilationOutput,
  CompileFailedError,
  CompilerKind,
  compileSync,
  DefaultASTWriterMapping,
  detectCompileErrors,
  FileSystemResolver,
  findAllFiles,
  FunctionDefinition,
  getCompilerForVersion,
  getFilesAndRemappings,
  LatestCompilerVersion,
  WasmCompiler,
  PrettyFormatter,
  SourceUnit,
  staticNodeFactory,
  ContractDefinition,
  ASTKind
} from "solc-typed-ast";
import { JsonFragment } from "@ethersproject/abi";
import path from "path";
import { writeFileSync } from "fs";
import { coerceArray, StructuredText, writeNestedStructure } from "./text";
import { addImports, findContractDefinition, findFunctionDefinition } from "./solc_ast_utils";
import { getCommonBasePath, mkdirIfNotExists } from "./path_utils";
import { getForgeRemappings } from "./forge_remappings";

function compile(
  compiler: WasmCompiler,
  files: Map<string, string>,
  remapping: string[],
  compilationOutput: CompilationOutput[] = compilerOutputs,
  compilerSettings?: any
) {
  const data = compileSync(compiler, files, remapping, compilationOutput, compilerSettings);
  const errors = detectCompileErrors(data);
  if (errors.length === 0) {
    Object.assign(data, { files });
    return data;
  }
  throw new CompileFailedError([{ compilerVersion: compiler.version, errors }]);
}

const compilerOutputs = [
  CompilationOutput.ABI,
  CompilationOutput.AST,
  "evm.deployedBytecode.object" as any,
  CompilationOutput.EVM_BYTECODE_OBJECT,
  "irOptimized" as any,
  "ir" as any
];

export type UserCompilerOptions = {
  metadata?: boolean;
  viaIR?: boolean;
  optimizer?: boolean;
  runs?: number | "max";
};

export type CompilerOptions = {
  metadata?: { bytecodeHash: "none" };
  viaIR?: boolean;
  optimizer?: {
    enabled?: boolean;
    runs?: number;
  };
  runs?: number | "max";
};

function parseCompilerOptions(options: UserCompilerOptions): CompilerOptions {
  const { metadata, viaIR, optimizer, runs } = options;
  const opts: CompilerOptions = {
    viaIR,
    optimizer: {
      enabled: optimizer || runs !== undefined,
      runs: runs === "max" ? 4_294_967_295 : runs
    }
  };
  if (!metadata) opts.metadata = { bytecodeHash: "none" };
  return opts;
}

export const compilerOptions: UserCompilerOptions = {
  viaIR: true,
  metadata: false
};

export const optimizedCompilerOptions: UserCompilerOptions = {
  ...compilerOptions,
  optimizer: true,
  runs: 200
};

export type ContractOutput = {
  abi: JsonFragment[];
  creationCode: string;
  runtimeCode: string;
  irOptimized: string;
  ir: string;
};

export type FunctionAddition = {
  code: string;
  name: string;
};

export type ContractAddition = {
  name: string;
  code: string[];
};

export class CompileHelper {
  resolver: FileSystemResolver;
  sourceUnits: SourceUnit[] = [];
  contractsMap = new Map<string, ContractOutput>();
  fileContractsMap = new Map<string, string[]>();
  writer = new ASTWriter(DefaultASTWriterMapping, new PrettyFormatter(2), LatestCompilerVersion);

  normalizePath(p: string): string {
    p = path.normalize(p);
    if (this.basePath && !path.isAbsolute(p)) {
      p = path.join(this.basePath, p);
    }
    return p;
  }

  set basePath(p: string | undefined) {
    this._basePath = p && path.normalize(p);
  }

  get basePath(): string | undefined {
    return this._basePath;
  }

  get context(): ASTContext {
    return this.sourceUnits[0].requiredContext;
  }

  getContractForFile(fileName: string): ContractOutput & { name: string } {
    fileName = path.normalize(fileName);
    let contracts = this.fileContractsMap.get(fileName);
    if (!contracts) {
      const fileNames = [...this.fileContractsMap.keys()].filter((f) => f.includes(fileName));
      if (fileNames.length === 0) {
        throw Error(`Source unit ${fileName} does not exist or has no contracts`);
      }
      if (fileNames.length > 1) {
        throw Error(`Multiple source units include ${fileName}:\n${fileNames.join(", ")}`);
      }
      fileName = fileNames[0];
      contracts = this.fileContractsMap.get(fileName) as string[];
    }

    if (contracts.length > 1) {
      throw Error(`Multiple contracts in ${fileName}`);
    }
    const contractName = contracts[0];
    return {
      name: contractName,
      ...(this.contractsMap.get(contractName) as ContractOutput)
    };
  }

  findSourceUnit(fileName: string): SourceUnit | undefined {
    fileName = this.normalizePath(fileName);
    const sourceUnit = this.sourceUnits.find(
      (unit) => this.normalizePath(unit.absolutePath) === fileName
    );
    return sourceUnit;
  }

  hasSourceUnit(fileName: string): boolean {
    return this.findSourceUnit(fileName) !== undefined;
  }

  getSourceUnit(fileName: string): SourceUnit {
    const sourceUnit = this.findSourceUnit(fileName);
    if (!sourceUnit) {
      console.log(`Searching for ${fileName} - no results`);
      const fileName2 = path.relative("", fileName);
      console.log(`With resolve? ${fileName2} exists: ${!!this.findSourceUnit(fileName2)}`);

      throw Error(`Could not find SourceUnit for ${fileName}`);
    }
    return sourceUnit;
  }

  getFiles(): Map<string, string> {
    const files = new Map<string, string>();
    for (const sourceUnit of this.sourceUnits) {
      files.set(sourceUnit.absolutePath, this.writer.write(sourceUnit));
    }
    return files;
  }

  addSourceUnit(name: string, code?: string): SourceUnit {
    let sourceUnit = this.findSourceUnit(name);
    if (!sourceUnit) {
      const absolutePath =
        this.basePath && !path.isAbsolute(name) ? path.join(this.basePath, name) : name;
      sourceUnit = staticNodeFactory.makeSourceUnit(
        this.context,
        name,
        this.sourceUnits.length,
        absolutePath,
        new Map<string, number>()
      );
      this.sourceUnits.push(sourceUnit);
      if (code) {
        const children = this.compileCodeInContext(name, code).children;
        for (const child of children) {
          sourceUnit.appendChild(child);
        }
      }
    }
    return sourceUnit;
  }

  updateMultipleContracts(
    sourceUnit: string,
    contractAdditions: Array<{
      contractName: string;
      _functions: FunctionAddition[] | FunctionAddition;
    }>
  ): void {
    const oldSource = this.getSourceUnit(sourceUnit);
    const addedCode: StructuredText[] = [];
    const contractsToDelete: string[] = [];
    const newContractFunctions: Record<string, string[]> = {};
    for (const { contractName, _functions } of contractAdditions) {
      const functions = coerceArray(_functions);
      const oldContract = findContractDefinition(oldSource, contractName);
      assert(oldContract !== undefined, `Contract ${contractName} not found in ${sourceUnit}`);
      // Identify functions which do not already exist in the contract
      const uniqueFunctions = functions.filter(
        ({ name }) => findFunctionDefinition(oldContract, name) === undefined
      );
      if (uniqueFunctions.length === 0) {
        continue;
      }
      // Get the new function code
      const newFunctionCode = uniqueFunctions.map((fn) => fn.code).join("\n");
      // Write the contract with the added functions
      let contractCode = this.writer.write(oldContract);
      // contractCode.slice(0, contractCode.lastIndexOf("}")).concat(newFunctionCode).concat("")
      contractCode = writeNestedStructure([
        contractCode.slice(0, contractCode.lastIndexOf("}")),
        newFunctionCode,
        "}"
      ]);
      addedCode.push(contractCode);
      contractsToDelete.push(contractName);
      newContractFunctions[contractName] = uniqueFunctions.map((fn) => fn.name);
    }
    // Function that removes the contract definition from the source unit copy prior to compiling in context
    const mutate = (source: SourceUnit) => {
      for (const contractName of contractsToDelete) {
        source.removeChild(findContractDefinition(source, contractName) as ContractDefinition);
      }
    };
    const newSource = this.compileCodeInContext(
      sourceUnit,
      writeNestedStructure(addedCode),
      mutate
    );
    for (const contractName of contractsToDelete) {
      const newContract = findContractDefinition(newSource, contractName);
      if (!newContract) {
        throw Error(`Contract ${contractName} not found in ${sourceUnit}`);
      }
      const newFunctions = newContractFunctions[contractName] as string[];
      newFunctions.forEach((name, i) => {
        const fnDefinition = findFunctionDefinition(newContract, name);
        assert(fnDefinition !== undefined, `${name} not found in compiled contract`);
        const oldContract = findContractDefinition(oldSource, contractName) as ContractDefinition;
        oldContract.appendChild(fnDefinition);
      });
    }
  }

  addFunctionsToContract(
    sourceUnit: string,
    contractName: string,
    _functions: FunctionAddition | FunctionAddition[]
  ): FunctionDefinition[] {
    const functions = coerceArray(_functions);
    const oldSource = this.getSourceUnit(sourceUnit);
    const oldContract = findContractDefinition(oldSource, contractName);
    if (!oldContract) {
      throw Error(`Contract ${contractName} not found in ${sourceUnit}`);
    }
    // Identify functions which do not already exist in the contract
    const functionDefinitions = functions.map(({ name }) =>
      findFunctionDefinition(oldContract, name)
    );
    const uniqueFunctions = functions.filter((fn, i) => functionDefinitions[i] === undefined);
    if (uniqueFunctions.length === 0) {
      return functionDefinitions as FunctionDefinition[];
    }
    // Get the new function code
    const newFunctionCode = uniqueFunctions.map((fn) => fn.code).join("\n");
    // Write the contract with the added functions
    let contractCode = this.writer.write(oldContract);
    // contractCode.slice(0, contractCode.lastIndexOf("}")).concat(newFunctionCode).concat("")
    contractCode = writeNestedStructure([
      contractCode.slice(0, contractCode.lastIndexOf("}")),
      newFunctionCode,
      "}"
    ]);
    // Function that removes the contract definition from the source unit copy prior to compiling in context
    const mutate = (source: SourceUnit) => {
      source.removeChild(findContractDefinition(source, contractName) as ContractDefinition);
    };
    const newSource = this.compileCodeInContext(sourceUnit, contractCode, mutate);
    const newContract = findContractDefinition(newSource, contractName);
    if (!newContract) {
      throw Error(`Contract ${contractName} not found in ${sourceUnit}`);
    }
    functionDefinitions.forEach((fnDefinition, i) => {
      if (fnDefinition) return;
      const { name } = functions[i];
      fnDefinition = findFunctionDefinition(newContract, name);
      if (!fnDefinition) {
        throw Error(`${name} not found in compiled contract`);
      }
      oldContract.appendChild(fnDefinition);
      functionDefinitions[i] = fnDefinition;
    });
    return functionDefinitions as FunctionDefinition[];
  }

  addFunctionCode(
    sourceUnit: string,
    _functions: FunctionAddition | FunctionAddition[]
  ): FunctionDefinition[] {
    const functions = coerceArray(_functions);
    const oldSource = this.getSourceUnit(sourceUnit);
    // Identify functions which do not already exist in the source unit
    const functionDefinitions = functions.map(({ name }) =>
      findFunctionDefinition(oldSource, name)
    );
    const uniqueFunctions = functions.filter((fn, i) => functionDefinitions[i] === undefined);
    if (uniqueFunctions.length === 0) {
      return functionDefinitions as FunctionDefinition[];
    }
    const newFunctionCode = uniqueFunctions.map((fn) => fn.code).join("\n");
    const newSource = this.compileCodeInContext(sourceUnit, newFunctionCode);

    functionDefinitions.forEach((fnDefinition, i) => {
      if (fnDefinition) return;
      const { name } = functions[i];
      fnDefinition = newSource.getChildrenByType(FunctionDefinition).find((fn) => fn.name === name);
      if (!fnDefinition) {
        throw Error(`${name} not found in compiled source unit`);
      }
      oldSource.appendChild(fnDefinition);
      functionDefinitions[i] = fnDefinition;
    });
    return functionDefinitions as FunctionDefinition[];
  }

  addImport(dstSourceUnit: string, srcSourceUnit: string): void {
    const dst = this.getSourceUnit(dstSourceUnit);
    const src = this.getSourceUnit(srcSourceUnit);
    addImports(dst, src, []);
  }

  writeFilesTo(basePath = this.basePath): void {
    const files = this.getFiles();
    const filePaths = [...files.keys()];
    const allAbsolutePaths = filePaths.every(path.isAbsolute);
    const commonPath = allAbsolutePaths && getCommonBasePath(filePaths);
    if (basePath !== undefined) {
      mkdirIfNotExists(basePath);
    }
    assert(
      commonPath !== undefined || basePath !== undefined,
      `Can not write files with non-absolute paths and no base path provided`
    );
    filePaths.forEach((filePath) => {
      // If the existing file paths are absolute, replace the common base path
      // with `basePath` if they are different.
      // If they are relative, resolve with `basePath`
      const file = files.get(filePath) as string;
      let absolutePath: string = filePath;
      if (basePath && commonPath !== basePath) {
        const relativePath = commonPath ? path.relative(commonPath, filePath) : filePath;
        absolutePath = path.resolve(basePath as string, relativePath);
      }
      writeFileSync(absolutePath, file);
    });
  }

  update(compileResult: any): void {
    const reader = new ASTReader();
    this.sourceUnits = reader.read(compileResult, ASTKind.Modern, compileResult.files);
    this.contractsMap = new Map<string, ContractOutput>();
    this.fileContractsMap = new Map<string, string[]>();

    const { contracts } = compileResult;
    if (contracts) {
      const fileNames = Object.keys(contracts);
      for (const fileName of fileNames) {
        const fileContracts = contracts[fileName];
        const contractNames = Object.keys(fileContracts);
        this.fileContractsMap.set(fileName, contractNames);
        for (const contractName of contractNames) {
          if (this.contractsMap.has(contractName)) {
            throw Error(`Duplicate contract name ${contractName}`);
          }
          const contract = fileContracts[contractName];
          const { ir, irOptimized, abi } = contract;
          const creationCode = contract.evm?.bytecode?.object ?? "";
          const runtimeCode = contract.evm?.deployedBytecode?.object ?? "";
          this.contractsMap.set(contractName, { ir, irOptimized, abi, creationCode, runtimeCode });
        }
      }
    }
  }

  recompile(optimize?: boolean, optionOverrides?: UserCompilerOptions): void {
    const files = this.getFiles();
    const resolvedFileNames = new Map<string, string>();
    findAllFiles(files, resolvedFileNames, [], []);
    const defaultOptions = optimize ? optimizedCompilerOptions : compilerOptions;
    const options = parseCompilerOptions({
      ...defaultOptions,
      ...optionOverrides
    });
    const compileResult = compile(this.compiler, files, [], compilerOutputs, options);
    this.update(compileResult);
  }

  compileCodeInContext(
    sourceUnitName: string,
    code: string,
    mutateSourceUnit?: (source: SourceUnit) => void
  ): SourceUnit {
    const factory = new ASTNodeFactory(this.context);
    const files = this.getFiles();
    let currentSourceUnit = this.getSourceUnit(sourceUnitName);
    if (mutateSourceUnit) {
      currentSourceUnit = factory.copy(currentSourceUnit);
      mutateSourceUnit(currentSourceUnit);
    }
    const updatedSource = writeNestedStructure([this.writer.write(currentSourceUnit), code]);
    files.set(currentSourceUnit.absolutePath, updatedSource);
    const resolvedFileNames = new Map<string, string>();
    findAllFiles(files, resolvedFileNames, [], []);
    const compileResult = compile(
      this.compiler,
      files,
      [],
      [CompilationOutput.AST],
      parseCompilerOptions(compilerOptions)
    );
    const reader = new ASTReader();
    const sourceUnits = reader.read(compileResult, ASTKind.Modern, compileResult.files);
    const sourceUnit = sourceUnits.find(
      (unit) => unit.absolutePath === currentSourceUnit.absolutePath
    );
    if (!sourceUnit) {
      throw Error(`Source unit not found in compiler output`);
    }
    const newSourceUnit = factory.copy(sourceUnit);
    return newSourceUnit;
  }

  static async fromFiles(
    version = LatestCompilerVersion,
    files: Map<string, string>,
    basePath?: string,
    optimize?: boolean
  ): Promise<CompileHelper> {
    const compiler = await getCompilerForVersion(version, CompilerKind.WASM);
    if (!(compiler instanceof WasmCompiler)) {
      throw Error(`WasmCompiler not found for ${version}`);
    }
    const compileResult = compile(
      compiler,
      files,
      [],
      compilerOutputs,
      optimize ? optimizedCompilerOptions : compilerOptions
    );
    return new CompileHelper(compiler, compileResult, basePath);
  }

  _files?: Map<string, string>;

  static async fromFileSystem(
    version = LatestCompilerVersion,
    fileNames: string | string[],
    basePath?: string,
    optimize?: boolean,
    optionOverrides?: UserCompilerOptions
  ): Promise<CompileHelper> {
    fileNames = coerceArray(fileNames);
    const includePath: string[] = [];
    if (basePath) {
      let parent = path.dirname(basePath);
      while (parent !== path.dirname(parent)) {
        includePath.push(parent);
        parent = path.dirname(parent);
      }
    }

    const { files, remapping } = getFilesAndRemappings(fileNames, {
      basePath,
      includePath,
      remapping: getForgeRemappings(basePath as string)
    });
    const filePaths = [...files.keys()];
    if (
      basePath &&
      filePaths.some(
        (p) => path.isAbsolute(p) && path.relative(basePath as string, p).startsWith("..")
      )
    ) {
      const commonPath = getCommonBasePath(filePaths);
      basePath = commonPath ? path.normalize(commonPath) : basePath;
    }
    console.log(basePath);

    const compiler = await getCompilerForVersion(version, CompilerKind.WASM);
    if (!(compiler instanceof WasmCompiler)) {
      throw Error(`WasmCompiler not found for ${version}`);
    }
    const defaultOptions = optimize ? optimizedCompilerOptions : compilerOptions;
    const options = parseCompilerOptions({
      ...defaultOptions,
      ...optionOverrides
    });
    const compileResult = compile(compiler, files, remapping, compilerOutputs, options);
    const helper = new CompileHelper(compiler, compileResult, basePath, options);
    helper._files = files;
    return helper;
  }

  constructor(
    public compiler: WasmCompiler,
    public compileResult: any,
    private _basePath?: string,
    public compilerOptions?: CompilerOptions
  ) {
    this.update(compileResult);
    this.resolver = new FileSystemResolver(this.basePath);
  }
}

export function writeFilesTo(basePath: string, files: Map<string, string>): void {
  const filePaths = [...files.keys()];
  const allAbsolutePaths = filePaths.every(path.isAbsolute);
  const commonPath = allAbsolutePaths && getCommonBasePath(filePaths);
  if (basePath !== undefined) {
    mkdirIfNotExists(basePath);
  }
  assert(
    commonPath !== undefined || basePath !== undefined,
    `Can not write files with non-absolute paths and no base path provided`
  );
  filePaths.forEach((filePath) => {
    // If the existing file paths are absolute, replace the common base path
    // with `basePath` if they are different.
    // If they are relative, resolve with `basePath`
    const file = files.get(filePath) as string;
    let absolutePath: string = filePath;
    if (basePath && commonPath !== basePath) {
      const relativePath = commonPath ? path.relative(commonPath, filePath) : filePath;
      absolutePath = path.resolve(basePath as string, relativePath);
    }

    mkdirIfNotExists(path.dirname(absolutePath));
    writeFileSync(absolutePath, file);
  });
}
