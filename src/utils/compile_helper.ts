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
  NativeCompiler,
  PrettyFormatter,
  SourceUnit,
  staticNodeFactory
} from "solc-typed-ast";
import { JsonFragment } from "@ethersproject/abi";
import path from "path";
import { writeFileSync } from "fs";
import { coerceArray, writeNestedStructure } from "./text";
import { addImports, findFunctionDefinition } from "./solc_ast_utils";
import { getCommonBasePath, mkdirIfNotExists } from "./path_utils";

function compile(
  compiler: NativeCompiler,
  files: Map<string, string>,
  remapping: string[],
  compilationOutput: CompilationOutput[] = compilerOutputs,
  compilerSettings?: any
) {
  const data = compileSync(compiler, files, remapping, compilationOutput, compilerSettings);
  const errors = detectCompileErrors(data);
  if (errors.length === 0) {
    return data;
  }
  throw new CompileFailedError([{ compilerVersion: compiler.version, errors }]);
}

const compilerOutputs = [
  CompilationOutput.ABI,
  CompilationOutput.AST,
  "evm.deployedBytecode.object" as any,
  CompilationOutput.EVM_BYTECODE_OBJECT,
  "irOptimized" as any
];

const compilerOptions = {
  viaIR: true,
  optimizer: {
    enabled: true,
    runs: 20000
  }
};

type ContractOutput = {
  abi: JsonFragment[];
  creationCode: string;
  runtimeCode: string;
  irOptimized: string;
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

  findSourceUnit(fileName: string): SourceUnit | undefined {
    fileName = this.normalizePath(fileName);
    const sourceUnit = this.sourceUnits.find(
      (unit) => this.normalizePath(unit.absolutePath) === fileName
    );
    return sourceUnit;
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
      const absolutePath = this.basePath ? path.join(this.basePath, name) : name;
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

  addFunctionCode(
    sourceUnit: string,
    functionCode: string,
    functionName: string
  ): FunctionDefinition {
    let fnDefinition = findFunctionDefinition(this.getSourceUnit(sourceUnit), functionName);
    if (fnDefinition) return fnDefinition;
    const newSource = this.compileCodeInContext(sourceUnit, functionCode);
    fnDefinition = newSource
      .getChildrenByType(FunctionDefinition)
      .find((fn) => fn.name === functionName);
    if (!fnDefinition) {
      throw Error(`${functionName} not found in compiled source unit`);
    }
    const oldSource = this.getSourceUnit(sourceUnit);
    oldSource.appendChild(fnDefinition);
    return fnDefinition;
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
    this.sourceUnits = reader.read(compileResult);
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
          const { irOptimized, abi } = contract;
          const creationCode = contract.evm?.bytecode?.object ?? "";
          const runtimeCode = contract.evm?.deployedBytecode?.object ?? "";
          this.contractsMap.set(contractName, { irOptimized, abi, creationCode, runtimeCode });
        }
      }
    }
  }

  recompile(): void {
    const files = this.getFiles();
    const resolvedFileNames = new Map<string, string>();
    findAllFiles(files, resolvedFileNames, [], []);
    const compileResult = compile(this.compiler, files, []);
    this.update(compileResult);
  }

  compileCodeInContext(sourceUnitName: string, code: string): SourceUnit {
    const files = this.getFiles();
    const currentSourceUnit = this.getSourceUnit(sourceUnitName);
    const updatedSource = writeNestedStructure([this.writer.write(currentSourceUnit), code]);
    files.set(currentSourceUnit.absolutePath, updatedSource);
    const resolvedFileNames = new Map<string, string>();
    findAllFiles(files, resolvedFileNames, [], []);
    const compileResult = compile(this.compiler, files, []);
    const reader = new ASTReader();
    const sourceUnits = reader.read(compileResult);
    const factory = new ASTNodeFactory(this.context);
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
    const compiler = await getCompilerForVersion(version, CompilerKind.Native);
    if (!(compiler instanceof NativeCompiler)) {
      throw Error(`NativeCompiler not found for ${version}`);
    }
    const compileResult = compile(
      compiler,
      files,
      [],
      compilerOutputs,
      optimize && compilerOptions
    );
    return new CompileHelper(compiler, compileResult, basePath);
  }

  static async fromFileSystem(
    version = LatestCompilerVersion,
    fileNames: string | string[],
    basePath?: string,
    optimize?: boolean
  ): Promise<CompileHelper> {
    fileNames = coerceArray(fileNames);
    const { files, remapping } = getFilesAndRemappings(fileNames, { basePath });
    const compiler = await getCompilerForVersion(version, CompilerKind.Native);
    if (!(compiler instanceof NativeCompiler)) {
      throw Error(`NativeCompiler not found for ${version}`);
    }
    const compileResult = compile(
      compiler,
      files,
      remapping,
      compilerOutputs,
      optimize && compilerOptions
    );
    return new CompileHelper(compiler, compileResult, basePath);
  }

  constructor(
    public compiler: NativeCompiler,
    public compileResult: any,
    private _basePath?: string
  ) {
    this.update(compileResult);
    this.resolver = new FileSystemResolver(this.basePath);
  }
}
