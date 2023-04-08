// SPDX-License-Identifier: MIT
pragma solidity >=0.8.13;

address constant VM_ADDRESS = address(uint160(uint256(keccak256("hevm cheat code"))));
IVm constant vm = IVm(VM_ADDRESS);

interface IVm {
  function toString(uint256) external returns (string memory);

  function serializeBool(
    string calldata objectKey,
    string calldata valueKey,
    bool value
  ) external returns (string memory json);

  function serializeUint(
    string calldata objectKey,
    string calldata valueKey,
    uint256 value
  ) external returns (string memory json);

  function serializeInt(
    string calldata objectKey,
    string calldata valueKey,
    int256 value
  ) external returns (string memory json);

  function serializeAddress(
    string calldata objectKey,
    string calldata valueKey,
    address value
  ) external returns (string memory json);

  function serializeBytes32(
    string calldata objectKey,
    string calldata valueKey,
    bytes32 value
  ) external returns (string memory json);

  function serializeString(
    string calldata objectKey,
    string calldata valueKey,
    string calldata value
  ) external returns (string memory json);

  function serializeBytes(
    string calldata objectKey,
    string calldata valueKey,
    bytes calldata value
  ) external returns (string memory json);

  function serializeBool(
    string calldata objectKey,
    string calldata valueKey,
    bool[] calldata values
  ) external returns (string memory json);

  function serializeUint(
    string calldata objectKey,
    string calldata valueKey,
    uint256[] calldata values
  ) external returns (string memory json);

  function serializeInt(
    string calldata objectKey,
    string calldata valueKey,
    int256[] calldata values
  ) external returns (string memory json);

  function serializeAddress(
    string calldata objectKey,
    string calldata valueKey,
    address[] calldata values
  ) external returns (string memory json);

  function serializeBytes32(
    string calldata objectKey,
    string calldata valueKey,
    bytes32[] calldata values
  ) external returns (string memory json);

  function serializeString(
    string calldata objectKey,
    string calldata valueKey,
    string[] calldata values
  ) external returns (string memory json);

  function serializeBytes(
    string calldata objectKey,
    string calldata valueKey,
    bytes[] calldata values
  ) external returns (string memory json);
}
