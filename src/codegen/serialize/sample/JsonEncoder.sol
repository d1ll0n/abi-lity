pragma solidity ^0.8.17;

import "./SomeFile.sol";
import "./JsonLib.sol";

library JsonEncoder {
  function serializeItem(Item memory value) internal pure returns (string memory output) {
    output = string.concat("{", JsonLib.serializeKeyValuePair("x", JsonLib.serializeUint(value.x), false), JsonLib.serializeKeyValuePair("y", JsonLib.serializeUint(value.y), false), JsonLib.serializeKeyValuePair("isValue", JsonLib.serializeBool(value.isValue), true), "}");
  }

  function serializeDynArrayItem(Item[] memory value) internal pure returns (string memory output) {
    output = "[";
    uint256 lastIndex = value.length - 1;
    for (uint256 i = 0; i < lastIndex; i++) {
      output = string.concat(output, serializeItem(value[i]), ",");
    }
    output = string.concat(output, serializeItem(value[lastIndex]), "]");
  }

  function serializeData(Data memory value) internal pure returns (string memory output) {
    output = string.concat("{", JsonLib.serializeKeyValuePair("item", serializeItem(value.item), false), JsonLib.serializeKeyValuePair("additionalItems", serializeDynArrayItem(value.additionalItems), true), "}");
  }
}