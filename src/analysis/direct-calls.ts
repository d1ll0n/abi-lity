import {
  ASTSearch,
  ASTWriter,
  ContractDefinition,
  ContractKind,
  DefaultASTWriterMapping,
  ExternalReferenceType,
  InferType,
  LatestCompilerVersion,
  PrettyFormatter
} from "solc-typed-ast";
import { CompileHelper } from "../utils/compile_utils/compile_helper";
import { getParentSourceUnit, getRelativePath } from "../utils";
const infer = new InferType(LatestCompilerVersion);

function trackDirectCallsInContract(contract: ContractDefinition, basePath: string) {
  const search = ASTSearch.fromContract(contract);
  const examples = search
    .find("FunctionCall", { vFunctionCallType: ExternalReferenceType.UserDefined })
    .filter((call) => {
      const closestContract =
        call.vReferencedDeclaration?.getClosestParentByType(ContractDefinition);
      if (!closestContract || closestContract.kind === ContractKind.Library) {
        return false;
      }
      return infer.isFunctionCallExternal(call);
    });
  const writer = new ASTWriter(
    DefaultASTWriterMapping,
    new PrettyFormatter(2),
    LatestCompilerVersion
  );

  examples.forEach((example) => {
    const sourceUnit = getParentSourceUnit(example);
    console.log(`In: ${getRelativePath(basePath, sourceUnit.absolutePath)}`);
    console.log(writer.write(example));
  });
}
async function testLookup() {
  const basePath = "/home/pc/wildcat/v1.2/src/market/";
  const helper = await CompileHelper.fromFileSystem(`WildcatMarket.sol`, basePath);
  const source = helper.getSourceUnit("WildcatMarket.sol");
  trackDirectCallsInContract(source.vContracts[0], basePath);
}
testLookup();
