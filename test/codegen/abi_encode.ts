/* eslint-disable @typescript-eslint/no-non-null-assertion */
// import { LatestCompilerVersion } from "solc-typed-ast";
// import { addDependencyImports } from "../../src";
// import "../../src/codegen/abi_encode/index";
// import { CodegenContext } from "../../src/codegen/utils";
import { CompileHelper } from "../../src/utils/compile_utils/compile_helper";
import { upgradeSourceCoders } from "../../src/codegen/coders/generate";
import path from "path";
import {
  ASTSearch,
  Expression,
  ExternalReferenceType,
  FunctionCall,
  FunctionDefinition,
  FunctionVisibility,
  Identifier,
  IdentifierPath,
  InferType,
  LatestCompilerVersion,
  MemberAccess,
  Return,
  UsingForDirective,
  VariableDeclaration,
  assert
} from "solc-typed-ast";

const Code = `
import "./ABCD.sol";


contract SomeFile {
  using ABCD for *;
}
`;

async function test2() {
  const helper = await CompileHelper.fromFiles(
    new Map([
      ["ABCD.sol", "library ABCD { function t(uint256) internal pure returns (uint256) {} }"],
      ["SomeFile.sol", Code]
    ])
  );
  const sourceUnit = helper.getSourceUnit("SomeFile.sol");
  const usingFor = sourceUnit.getChildrenByType(UsingForDirective)[0];
  console.log(usingFor.vLibraryName?.type);
  if (usingFor.vLibraryName instanceof IdentifierPath) {
    console.log(usingFor.vLibraryName.name);
  }
}

function isBuiltinFunctionCallTo(call: Expression, name: string): call is FunctionCall {
  if (!(call instanceof FunctionCall && call.vFunctionCallType === ExternalReferenceType.Builtin)) {
    return false;
  }
  const nameParts = name.split(".");
  if (nameParts.length === 1) {
    return call.vFunctionName === name;
  }
  assert(nameParts.length === 2, `Unrecognized builtin function name: ${name}`);
  const vCallee = call.vCallee;
  return (
    call.vFunctionCallType === ExternalReferenceType.Builtin &&
    vCallee instanceof MemberAccess &&
    vCallee.memberName === nameParts[1] &&
    vCallee.vExpression instanceof Identifier &&
    vCallee.vExpression.name === nameParts[0]
  );
}

function isAbiEncodeCall(call: FunctionCall) {
  const vCallee = call.vCallee;
  return (
    call.vFunctionCallType === ExternalReferenceType.Builtin &&
    vCallee instanceof MemberAccess &&
    vCallee.memberName === "encode" &&
    vCallee.vExpression instanceof Identifier &&
    vCallee.vExpression.name === "abi"
  );
}

const _map = new Map([[CompileHelper, "CompileHelper"]]);

async function test() {
  const helper = await CompileHelper.fromFileSystem("SomeFile.sol", __dirname);
  const sourceUnit = helper.getSourceUnit("SomeFile.sol");
  const search = ASTSearch.from(sourceUnit);
  const abiEncodeCalls = search.find(
    "FunctionCall",

    {
      ancestors: [
        {
          tag: "FunctionDefinition",
          visibility: FunctionVisibility.External
        }
      ],
      vFunctionCallType: ExternalReferenceType.Builtin,
      vFunctionName: "encode",
      vIdentifier: "abi"
    }
  );
  /*   console.log(`Encode Calls: ${abiEncodeCalls.length}`);
  if (abiEncodeCalls.length > 0) {
    for (const call of abiEncodeCalls) {
      const parent = call.getClosestParentByType(FunctionDefinition);
      console.log(`Parent: ${parent?.name}`);
    }
    return;
  } */
  const r = _map.get(helper.constructor as any);
  console.log(r);
  const ret = sourceUnit
    .getChildrenByType(FunctionDefinition)
    .find((fn) => fn.name === "testFunction");

  const fn = sourceUnit
    .getChildrenByType(FunctionDefinition)
    .find((fn) => fn.name === "fnWithPubRef");
  const mem = fn?.getChildrenByType(MemberAccess)[0];
  const baseVar = sourceUnit
    .getChildrenByType(VariableDeclaration)
    .find((v) => v.name === "stateVariable3");

  console.log(`stateVariable3: ${baseVar?.id}`);
  console.log(`mem: ${mem?.referencedDeclaration}`);

  console.log(ret?.vParameters.vParameters[0].typeString);
  const fnCalls = sourceUnit
    .getChildrenByType(FunctionCall)
    .filter((call) => isBuiltinFunctionCallTo(call, "abi.encode"));
  console.log(`abi encode calls ${fnCalls.length}`);

  const ctx = upgradeSourceCoders(
    helper,
    "SomeFile.sol",
    {
      // outputPath: path.join(__dirname, "out2"),
      outputToLibrary: false,
      replaceAbiEncodeCalls: true,
      replaceStateVariables: true,
      replaceHashCalls: true,
      replaceEmitCalls: true,
      replaceReturnStatements: true
      // functionSwitch: true
    }
    // path.join(__dirname, "out")
  );
  helper.writeFilesTo(path.join(__dirname, "out2"));
  /*   
  const ctx = new CodegenContext(helper, "Decode.sol", __dirname);
  ctx.addPointerLibraries();
  const fn = sourceUnit.getChildrenBySelector(isExternalFunction)[0] as FunctionDefinition;
  addDependencyImports(ctx.decoderSourceUnit, fn);
  const type = functionDefinitionToTypeNode(fn);

  abiEncodingFunctionParameters(ctx, type);
  ctx.applyPendingFunctions();
  helper.writeFilesTo(path.join(__dirname, "out")); */
}
test();
