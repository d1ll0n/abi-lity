// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

struct ABC {
  uint96 abc;
  uint128 x;
  uint256 c;
}

interface IBaseCopier {
  function copy_ABC (ABC calldata input) external view returns (ABC memory);
}