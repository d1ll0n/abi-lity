/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ContractDefinition } from "solc-typed-ast";

import { CompileHelper } from "../../src/utils/compile_utils/compile_helper";
import { getPublicStateVariables } from "../../src/utils";

async function test() {
  const files = new Map([
    [
      `File1.sol`,

      `
      struct Data { uint256 a; }
      abstract contract ContractA {
      uint256 public x;
      Data public data;
      function foo() public {}
      function val() external view virtual returns (uint256);
    }`
    ],
    [
      `File2.sol`,
      `import "./File1.sol";

      contract ContractB is ContractA {
        uint256 public y;
        uint256 public override val;
        uint256[][] internal _arr1;
        mapping(address => mapping(uint256 => Data)) public datas;
        mapping(address => mapping(uint256 => Data)) internal datas2;

        function bar() public view returns (uint256) {
          return _arr1[0][0] + datas[msg.sender][0].a;
        }
      }
      `
    ]
  ]);
  const helper = await CompileHelper.fromFiles(files, undefined);
  const sourceUnit = helper.getSourceUnit("File2.sol");
  const contract = sourceUnit.getChildrenByType(ContractDefinition)[0] as ContractDefinition;
  /*  const arr = contract.getChildrenByType(IndexAccess)[0];
  if (arr) {
    console.log(arr.typeString);
    return;
  } */
  const stateVariables = contract.vStateVariables;
  const publicStateVariables = getPublicStateVariables(contract);
  console.log(
    `State variables: ${stateVariables.length} (${stateVariables.map((v) => v.name).join(", ")})`
  );
  console.log(
    `State variables: ${publicStateVariables.length} (${publicStateVariables
      .map((v) => v.name)
      .join(", ")})`
  );
  renamePublicStateVariable(contract);
  const files2 = helper.getFiles();
  console.log("-".repeat(80));
  console.log(files2.get("File1.sol"));
  console.log("-".repeat(80));
  console.log(files2.get("File2.sol"));
}
