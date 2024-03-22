/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CompileHelper } from "../src/utils/compile_utils/compile_helper";
import { WrappedScope, WrappedSourceUnit } from "../src/codegen/ctx/contract_wrapper";
import {
  ASTSearch,
  ContractDefinition,
  FunctionDefinition,
  SourceUnit,
  StructDefinition
} from "solc-typed-ast";

export class TestCodeHelper {
  sourceUnit: SourceUnit;
  private _search: ASTSearch | undefined;

  constructor(public helper: CompileHelper) {
    this.sourceUnit = helper.getSourceUnit("SomeFile.sol");
  }

  getStruct(name: string): StructDefinition {
    return this.search.find("StructDefinition", { name })[0]!;
  }

  getContract(name: string): ContractDefinition {
    return this.search.find("ContractDefinition", { name })[0]!;
  }

  getFunction(name: string): FunctionDefinition {
    return this.search.find("FunctionDefinition", { name })[0]!;
  }

  get ctx(): WrappedScope {
    return WrappedSourceUnit.getWrapper(this.helper, this.sourceUnit);
  }

  get search(): ASTSearch {
    if (!this._search) {
      this._search = ASTSearch.from(this.sourceUnit);
    }
    return this._search;
  }

  static async fromCode(code: string): Promise<TestCodeHelper> {
    const fileName = "SomeFile.sol";
    const helper = await CompileHelper.fromFiles(new Map([[fileName, code]]));
    return new TestCodeHelper(helper);
  }
}
