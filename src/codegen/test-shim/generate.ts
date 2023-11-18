/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { WrappedScope, WrappedSourceUnit } from "../ctx/contract_wrapper";
import {
  ContractDefinition,
  ContractKind,
  DataLocation,
  ErrorDefinition,
  FunctionDefinition,
  FunctionKind,
  RevertStatement,
  SourceUnit
} from "solc-typed-ast";
import { pascalCaseToCamelCase } from "../names";
import {
  StructuredText,
  getDirectory,
  getParentSourceUnit,
  getRelativePath,
  isExternalFunction,
  writeNestedStructure
} from "../../utils";
import { FunctionType } from "../../ast";
import { functionDefinitionToTypeNode } from "../../readers";
import { CompileHelper } from "../../utils/compile_utils/compile_helper";
import path from "path";

type Options = {
  concrete?: boolean;
  fuzz?: boolean;
  failures?: boolean;
};

const allUnique = <T>(arr: T[]): boolean => new Set(arr).size === arr.length;

/* 	// ===================================================================== //
	//                             Vault State                               //
	// ===================================================================== // */

const makeCommentSeparator = (comment: string): StructuredText => {
  const row = `// ===================================================================== //`;
  const rowWidth = row.length;
  const paddingNeeded = rowWidth - comment.length - 6;
  const leftPadding = Math.floor(paddingNeeded / 2);
  const rightPadding = paddingNeeded - leftPadding;
  return [row, `// ${" ".repeat(leftPadding)}${comment}${" ".repeat(rightPadding)} //`, row];
};

export function generateForgeTestShim(
  ctx: WrappedSourceUnit,
  contract: ContractDefinition,
  options: Options
): string {
  const code: StructuredText[] = [];
  const srcPath = getDirectory(ctx.sourceUnit.absolutePath);
  const importSourcePath = getParentSourceUnit(contract).absolutePath;
  const importPath = getRelativePath(srcPath, importSourcePath);
  const outCode = [
    `// SPDX-License-Identifier: MIT`,
    `pragma solidity >=0.8.17;`,
    ``,
    `import { Test } from "forge-std/Test.sol";`,
    `import "${importPath}";`,
    "",
    `contract ${contract.name}Test is Test {`,
    code,
    `}`
  ];
  const isContract = [ContractKind.Contract, ContractKind.Interface].includes(contract.kind);
  const functions = isContract
    ? contract.vFunctions.filter(
        (fn) =>
          isExternalFunction(fn) &&
          ![FunctionKind.Fallback, FunctionKind.Receive, FunctionKind.Constructor].includes(fn.kind)
      )
    : contract.vFunctions;
  let contractReferenceName: string;
  if (isContract) {
    contractReferenceName = pascalCaseToCamelCase(contract.name);
    code.push(`${contract.name} internal ${contractReferenceName};`, "");
  } else {
    contractReferenceName = contract.name;
  }

  const fnTypes: Map<FunctionDefinition, FunctionType> = new Map();
  const fnParameterNames = new Map<FunctionDefinition, string[]>();
  const fnSignatures = new Set<string>();

  for (const fn of functions) {
    const fnType = functionDefinitionToTypeNode(fn);
    fnTypes.set(fn, fnType);
    let names: string[];
    if (fnType.parameters?.vMembers.every((m) => m.labelFromParent)) {
      names = fnType.parameters?.vMembers.map((m) => m.labelFromParent!) ?? [];
    } else {
      names = fnType.parameters?.vMembers.map((_, i) => `param${i}`) ?? [];
    }
    fnParameterNames.set(fn, names);
  }

  for (const fn of functions) {
    const fnRef = `${contractReferenceName}.${fn.name}`;
    const fnType = fnTypes.get(fn)!;
    const names = fnParameterNames.get(fn)!;
    const parameters = fnType.parameters?.vMembers ?? [];
    const paramDeclarations = parameters.map((param, i) =>
      param.writeParameter(DataLocation.Memory, names[i])
    );
    const baseFnSignature = fnType.signature(true);
    const separator = makeCommentSeparator(baseFnSignature);
    code.push(...separator, "");
    const typeString = ["", parameters.map((m) => m.canonicalName)].join("_");

    if (options.fuzz && (!options.concrete || parameters.length > 0)) {
      const fnSignature = `test_${fn.name}(${paramDeclarations.join(", ")})`;
      if (!fnSignatures.has(fnSignature)) {
        fnSignatures.add(fnSignature);
        const fnDef = [
          `function ${fnSignature} external {`,
          [`${fnRef}(${names.join(", ")});`],
          `}`
        ];
        code.push(fnDef, "");
      }
    }
    if (options.concrete) {
      let fnSignature = `test_${fn.name}()`;
      if (fnSignatures.has(fnSignature)) {
        fnSignature = `test_${fn.name}${typeString}()`;
      }
      if (!fnSignatures.has(fnSignature)) {
        fnSignatures.add(fnSignature);
        const fnDef = [
          `function ${fnSignature} external {`,
          [...paramDeclarations.map((p) => p + ";"), `${fnRef}(${names.join(", ")});`],
          `}`
        ];
        code.push(fnDef, "");
      }
    }
    if (options.failures) {
      const calledErrors = fn
        .getChildrenByType(RevertStatement)
        .map((r) => r.errorCall.vReferencedDeclaration)
        .filter(Boolean) as ErrorDefinition[];

      for (const error of calledErrors) {
        // const fnSignature = `test_${fn.name}_${error.name}()`;
        let fnSignature = `test_${fn.name}_${error.name}()`;
        if (fnSignatures.has(fnSignature)) {
          fnSignature = `test_${fn.name}${typeString}_${error.name}()`;
        }
        const errorReference =
          error.parent instanceof SourceUnit
            ? error.name
            : (error.parent as ContractDefinition).name + "." + error.name;
        if (!fnSignatures.has(fnSignature)) {
          fnSignatures.add(fnSignature);
          const fnDef = [
            `function ${fnSignature} external {`,
            [
              ...paramDeclarations.map((p) => p + ";"),
              `vm.expectRevert(${errorReference}.selector);`,
              `${fnRef}(${names.join(", ")});`
            ],
            `}`
          ];
          code.push(fnDef, "");
        }
      }
    }
  }

  return writeNestedStructure(outCode);
}

// const code = `contract Token {
//   error SomeError();

//   function transfer(address account, uint256 amount) external {
//     if (amount > 0 && account != address(0)) {
//       revert SomeError();
//     }
//   }

//   function transfer(address account) external {
//     if (account != address(0)) {
//       revert SomeError();
//     }
//   }
// }`;

// async function test() {
//   const helper = await CompileHelper.fromFiles(
//     new Map([[path.join(__dirname, "Token.sol"), code]]),
//     __dirname
//   );
//   const ctx = WrappedSourceUnit.getWrapper(helper, "Token.sol");
//   const contract = ctx.sourceUnit.getChildrenByType(ContractDefinition)[0];
//   const outPath = path.join(__dirname, "out");
//   const newCtx = WrappedSourceUnit.getWrapper(helper, "TokenTest.sol", outPath);
//   const newCode = generateForgeTestShim(newCtx, contract, {
//     concrete: true,
//     failures: true,
//     fuzz: true
//   });
//   console.log(newCode);
// }
// test();
