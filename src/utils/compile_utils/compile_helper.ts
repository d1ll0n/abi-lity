/**
 * Compilation wrapper around solc-typed-ast.
 *
 * {@link CompileHelper} manages the full compile → read-AST → mutate → recompile
 * lifecycle. Provides source-unit lookup, code mutation queuing, and static
 * factory methods for compiling from files or the filesystem.
 */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { readdirSync, writeFileSync } from "fs";
import path from "path";
import {
  assert,
  ASTContext,
  ASTReader,
  ASTWriter,
  DefaultASTWriterMapping,
  FileSystemResolver,
  findAllFiles,
  LatestCompilerVersion,
  WasmCompiler,
  PrettyFormatter,
  SourceUnit,
  staticNodeFactory,
  ASTKind,
  ASTNode,
  ContractDefinition,
  ASTNodeFactory
} from "solc-typed-ast";
import { coerceArray } from "../text";
import { addImports } from "../solc_ast_utils";
import {
  FilesCache,
  getCommonBasePath,
  getFilesCache,
  getNewFiles,
  getRelativePath,
  mkdirIfNotExists,
  resolveSolidityFiles
} from "../files";
import { ASTSourceMap } from "../source_editor";
import { ContractOutput, compile, CompilerOpts, compileAsync, getCompileOptions } from "./solc";
import { CodeMutation, applyMutations, getInsertionMutation } from "./mutations";

/** A pending function addition: name and source code to be inserted. */
export type FunctionAddition = {
  code: string;
  name: string;
};

/** A pending contract addition: name and code lines to be inserted. */
export type ContractAddition = {
  name: string;
  code: string[];
};

/**
 * Central compilation helper. Wraps solc compilation with AST read/write,
 * source-unit management, code mutation queuing, and recompilation.
 *
 * Use the static factories `fromFiles()` or `fromFileSystem()` to create instances.
 * After construction, mutate the AST or queue text mutations, then call
 * `applyMutations()` and/or `recompile()` to produce updated output.
 */
export class CompileHelper {
  sourceUnits: SourceUnit[] = [];
  contractsMap = new Map<string, ContractOutput>();
  fileContractsMap = new Map<string, string[]>();

  writer = new ASTWriter(DefaultASTWriterMapping, new PrettyFormatter(2), LatestCompilerVersion);

  mutationsCache: CodeMutation[] = [];

  _context: ASTContext | undefined;
  _factory: ASTNodeFactory | undefined;
  _files?: Map<string, string>;
  _filesCache?: FilesCache;

  get context(): ASTContext {
    assert(this._context !== undefined, "Context not set");
    return this._context;
  }

  set context(context: ASTContext) {
    this._context = context;
    this._factory = new ASTNodeFactory(context);
  }

  get factory(): ASTNodeFactory {
    assert(this._factory !== undefined, "Factory not set");
    return this._factory;
  }

  set files(files: Map<string, string>) {
    this._files = files;
    this._filesCache = getFilesCache(files);
  }

  getNewFiles(): Map<string, string> {
    const files = this.getFiles();
    if (!this._filesCache) return files;
    return getNewFiles(files, this._filesCache);
  }

  constructor(
    public compiler: WasmCompiler,
    public compileResult: any,
    private _basePath?: string,
    public compilerOptions?: CompilerOpts,
    public remapping?: string[]
  ) {
    this.handleCompilerOutput(compileResult);
  }

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

  /** Returns all contract outputs for the given file, supporting partial path matching. */
  getContractsForFile(fileName: string): Array<ContractOutput & { name: string }> {
    fileName = path.normalize(fileName);
    if (path.isAbsolute(fileName) && this.basePath) {
      fileName = getRelativePath(this.basePath, fileName);
    }
    let contracts = this.fileContractsMap.get(fileName);
    if (!contracts) {
      // Split the input fileName into its path components, as it could be a partial path
      const addSeparatorIfNotPath = (p: string) => (p.includes(path.sep) ? p : path.sep + p);
      const searchFileName = addSeparatorIfNotPath(fileName);
      const fileNames = [...this.fileContractsMap.keys()].filter((f) =>
        addSeparatorIfNotPath(f).includes(searchFileName)
      );

      // const fileNames = [...this.fileContractsMap.keys()].filter((f) => f.includes(fileName));
      if (fileNames.length === 0) {
        throw Error(`Source unit ${fileName} does not exist or has no contracts`);
      }
      if (fileNames.length > 1) {
        throw Error(`Multiple source units include ${fileName}:\n${fileNames.join(", ")}`);
      }
      fileName = fileNames[0];
      contracts = this.fileContractsMap.get(fileName) as string[];
    }
    return contracts.map((name) => ({
      name,
      ...(this.contractsMap.get(name) as ContractOutput)
    }));
  }

  getContractForFile(fileName: string): ContractOutput & { name: string } {
    fileName = path.normalize(fileName);
    const contracts = this.getContractsForFile(fileName);

    if (contracts.length > 1) {
      throw Error(`Multiple contracts in ${fileName}`);
    }
    return contracts[0];
  }

  /** Finds a SourceUnit by file name (normalizes the path). */
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

  /** Gets a SourceUnit by file name, throwing if not found. */
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

  /** Serializes all SourceUnits back to source code using the AST writer. */
  getFiles(sourceMap?: ASTSourceMap): Map<string, string> {
    const files = new Map<string, string>();
    for (const sourceUnit of this.sourceUnits) {
      files.set(sourceUnit.absolutePath, this.writer.write(sourceUnit, sourceMap));
    }
    return files;
  }

  writeFilesTo(basePath = this.basePath): void {
    const files = this.getFiles();
    writeFilesTo(basePath, files);
  }

  //---------------------------------------------------//
  //                      COMPILER                     //
  //---------------------------------------------------//

  /** Reads AST and contract outputs from a raw solc compile result. */
  handleCompilerOutput(compileResult: any): void {
    const reader = new ASTReader((this.context = new ASTContext()));
    this.sourceUnits = reader.read(compileResult, ASTKind.Modern, compileResult.files);
    this.contractsMap = new Map<string, ContractOutput>();
    this.fileContractsMap = new Map<string, string[]>();

    const { contracts } = compileResult;
    if (contracts) {
      const fileNames = Object.keys(contracts);
      for (const fileName of fileNames) {
        // console.log(`File ${fileName}`);
        const fileContracts = contracts[fileName];
        const contractNames = Object.keys(fileContracts);
        this.fileContractsMap.set(fileName, contractNames);
        for (let contractName of contractNames) {
          // console.log(`Contract ${contractName} in ${fileName}`);
          const contract = fileContracts[contractName];
          if (this.contractsMap.has(contractName)) {
            // throw Error(`Duplicate contract name ${contractName}`);
            console.log(`Duplicate contract name ${contractName}`);
            contractName = `${fileName}:${contractName}`;
          }
          const { ir, irOptimized, irAst, irOptimizedAst, abi } = contract;
          const creationCode = contract.evm?.bytecode?.object ?? "";
          const runtimeCode = contract.evm?.deployedBytecode?.object ?? "";
          const generatedSources: any = contract.evm?.deployedBytecode?.generatedSources;
          const sourceMap: string | undefined = contract.evm?.deployedBytecode?.sourceMap;
          const functionDebugData: any = contract.evm?.deployedBytecode?.functionDebugData;
          const assembly = contract.evm?.assembly;
          this.contractsMap.set(contractName, {
            assembly,
            ir,
            irAst,
            irOptimized,
            irOptimizedAst,
            abi,
            creationCode,
            runtimeCode,
            generatedSources,
            sourceMap,
            functionDebugData
          });
        }
      }
    }
  }

  /** Re-serializes all source units and recompiles, refreshing the AST and contract outputs. */
  recompile(options?: CompilerOpts): void {
    const files = this.getFiles();
    const resolvedFileNames = new Map<string, string>();
    findAllFiles(files, resolvedFileNames, [], []);
    const newOptions = options ? getCompileOptions(options) : this.compilerOptions ?? {};
    const { settings, outputs } = newOptions;
    if (options) {
      this.compilerOptions = newOptions;
    }

    const compileResult = compile(this.compiler, files, this.remapping ?? [], outputs, settings);

    // const dir = path.join(__dirname, "compile_results");
    // mkdirIfNotExists(dir);
    // const dirChildCount = readdirSync(dir).length;
    // const fileName = path.join(dir, `compile_result_${dirChildCount}.json`);
    // writeFileSync(fileName, JSON.stringify({ ...compileResult, settings }, null, 2));

    this.handleCompilerOutput(compileResult);
  }

  //---------------------------------------------------//
  //                      MUTATIONS                    //
  //---------------------------------------------------//

  // Returns bool indicating whether cache contains a mutation for the
  // source unit which needs to be applied.
  addSourceUnitMutation(fileName: string, code: string): boolean {
    const absolutePath = this.normalizePath(fileName);
    const sourceUnit = this.findSourceUnit(absolutePath);
    if (!sourceUnit) {
      const existingMutation = this.mutationsCache.find(
        (m) => m.kind === "addSourceUnit" && m.sourceUnitName === fileName
      );
      if (!existingMutation) {
        this.mutationsCache.push({
          kind: "addSourceUnit",
          sourceUnitName: fileName,
          code
        });
        return true;
      }
    }
    return false;
  }

  getOrCreateSourceUnit(fileName: string): SourceUnit {
    const absolutePath = this.normalizePath(fileName);
    let sourceUnit = this.findSourceUnit(absolutePath);
    if (!sourceUnit) {
      const existingMutation = this.mutationsCache.findIndex(
        (m) => m.kind === "addSourceUnit" && m.sourceUnitName === fileName
      );
      assert(
        existingMutation === -1,
        `Can not create new SourceUnit ${fileName} with pending mutation`
      );
      sourceUnit = this.factory.makeSourceUnit(
        fileName,
        this.sourceUnits.length,
        absolutePath,
        new Map<string, number>()
      );
      this.sourceUnits.push(sourceUnit);

      if (sourceUnit.children.length === 0) {
        const [, major, minor] = LatestCompilerVersion.split(".");
        sourceUnit.insertAtBeginning(
          staticNodeFactory.makePragmaDirective(sourceUnit.requiredContext, [
            "solidity",
            "^",
            `0.${major}`,
            `.${minor}`
          ])
        );
      }
    }
    return sourceUnit;
  }

  addImport(dstSourceUnit: string, srcSourceUnit: string): void {
    const dst = this.getSourceUnit(dstSourceUnit);
    const src = this.getSourceUnit(srcSourceUnit);
    addImports(dst, src, []);
  }

  /**
   * Queues a function definition insertion into the given scope.
   * The function is inserted before `referenceNode` if provided, otherwise appended.
   * The optional callback is invoked with the resulting AST node after compilation.
   */
  addFunctionMutation(
    scope: ContractDefinition | SourceUnit,
    code: string,
    name: string,
    referenceNode: ASTNode,
    cb?: (node: ASTNode) => void
  ): void;
  addFunctionMutation(
    scope: ContractDefinition | SourceUnit,
    code: string,
    name: string,
    cb?: (node: ASTNode) => void
  ): void;
  addFunctionMutation(
    scope: ContractDefinition | SourceUnit,
    code: string,
    name: string,
    referenceNode?: ASTNode | ((node: ASTNode) => void),
    cb?: (node: ASTNode) => void
  ): void {
    const action = referenceNode instanceof ASTNode ? "insertBefore" : "append";
    if (action === "insertBefore") {
      console.log("insertBefore @ " + name);
    }
    if (!referenceNode) {
      referenceNode = scope;
    }
    if (typeof referenceNode === "function") {
      cb = referenceNode;
      referenceNode = scope;
    }

    const mutation = getInsertionMutation({
      referenceNode,
      code,
      action,
      name,
      type: "FunctionDefinition",
      scope,
      cb
    });
    if (mutation) {
      this.mutationsCache.push(mutation);
    }
  }

  /** Queues a contract definition insertion into the given source unit. */
  addContractMutation(
    sourceUnit: SourceUnit,
    name: string,
    code: string,
    cb?: (node: ASTNode) => void
  ): void {
    const mutation = getInsertionMutation({
      name,
      code,
      action: "append",
      type: "ContractDefinition",
      scope: sourceUnit,
      cb
    });
    if (mutation) {
      this.mutationsCache.push(mutation);
    }
  }

  /** Applies all queued mutations: edits source text, recompiles, and copies new nodes into the existing AST. */
  applyMutations(): ASTNode[] {
    const mutations = this.mutationsCache;
    this.mutationsCache = [];
    return applyMutations(this, mutations);
  }

  addSourceUnit(name: string, code?: string): SourceUnit {
    let sourceUnit = this.findSourceUnit(name);
    if (!sourceUnit) {
      if (code) {
        if (this.addSourceUnitMutation(name, code)) {
          this.applyMutations();
        }
        sourceUnit = this.getSourceUnit(name);
      } else {
        sourceUnit = this.getOrCreateSourceUnit(name);
      }
    }
    return sourceUnit;
  }

  /** Creates a CompileHelper from in-memory source files. */
  static async fromFiles(
    files: Map<string, string>,
    basePath?: string,
    options?: CompilerOpts
  ): Promise<CompileHelper> {
    const { compiler, options: newOptions, output } = await compileAsync(files, [], options);
    /*     if (!(compiler instanceof WasmCompiler)) {
      throw Error(`Wrong compiler found for ${newOptions.version}`);
    } */

    const helper = new CompileHelper(compiler, output, basePath, newOptions);
    helper.files = files;
    return helper;
  }

  /** Creates a CompileHelper by reading Solidity files from disk, resolving Foundry remappings. */
  static async fromFileSystem(
    fileNames: string | string[],
    basePath?: string,
    options?: CompilerOpts
  ): Promise<CompileHelper> {
    fileNames = coerceArray(fileNames);
    const { remapping, files } = resolveSolidityFiles(fileNames, basePath);
    const { compiler, options: newOptions, output } = await compileAsync(files, remapping, options);
    /*   if (!(compiler instanceof WasmCompiler)) {
      throw Error(`Wrong compiler found for ${newOptions.version}`);
    } */

    const helper = new CompileHelper(compiler, output, basePath, newOptions, remapping);
    helper.files = files;
    return helper;
  }
}

/** Writes a map of file paths → source code to disk, resolving against `basePath`. */
export function writeFilesTo(basePath: string | undefined, files: Map<string, string>): void {
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
