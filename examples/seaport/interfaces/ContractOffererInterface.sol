pragma solidity ^0.8.7;

import { SpentItem, ReceivedItem } from "../lib/ConsiderationStructs.sol";

interface ContractOffererInterface {
  function generateOrder(address fulfiller, SpentItem[] calldata minimumReceived, SpentItem[] calldata maximumSpent, bytes calldata context) external returns (SpentItem[] memory offer, ReceivedItem[] memory consideration);

  function ratifyOrder(SpentItem[] calldata offer, ReceivedItem[] calldata consideration, bytes calldata context, bytes32[] calldata orderHashes, uint256 contractNonce) external returns (bytes4 ratifyOrderMagicValue);

  function previewOrder(address caller, address fulfiller, SpentItem[] calldata minimumReceived, SpentItem[] calldata maximumSpent, bytes calldata context) external view returns (SpentItem[] memory offer, ReceivedItem[] memory consideration);

  function getMetadata() external view returns (uint256 schemaID, string memory name, bytes memory metadata);
}