pragma solidity ^0.8.17;

import "../test/ConsiderationStructs.sol";
import "./Tmp_Assert.sol";

using LibString for uint256;
contract Assertions is StdAssertions {
function assertEqAddress(address actual, address expected, string memory key) internal {
  return assertEq(actual, expected, key);
}
function assertEqItemType(ItemType actual, ItemType expected, string memory key) internal {
  string[6] memory members = [
    "NATIVE",
    "ERC20",
    "ERC721",
    "ERC1155",
    "ERC721_WITH_CRITERIA",
    "ERC1155_WITH_CRITERIA"
  ];
  assertEq(members[uint256(actual)], members[uint256(expected)], key);
}
function assertEqUint256(uint256 actual, uint256 expected, string memory key) internal {
  return assertEq(actual, expected, key);
}
function assertEqOfferItem(OfferItem memory actual, OfferItem memory expected, string memory key) internal {
  assertEqItemType(actual.itemType, expected.itemType, string.concat(key, ".itemType"));
  assertEqAddress(actual.token, expected.token, string.concat(key, ".token"));
  assertEqUint256(actual.identifierOrCriteria, expected.identifierOrCriteria, string.concat(key, ".identifierOrCriteria"));
  assertEqUint256(actual.startAmount, expected.startAmount, string.concat(key, ".startAmount"));
  assertEqUint256(actual.endAmount, expected.endAmount, string.concat(key, ".endAmount"));
}
function assertEqDynArrayOfferItem(OfferItem[] memory actual, OfferItem[] memory expected, string memory key) internal {
  uint256 length = actual.length;
  assertEq(length, expected.length, string.concat(key, ".length"));
  for (uint256 i; i < length; i++) {
    assertEqOfferItem(actual[i], expected[i], string.concat(key, "[", i.toString(), "]"));
  }
}
function assertEqConsiderationItem(ConsiderationItem memory actual, ConsiderationItem memory expected, string memory key) internal {
  assertEqItemType(actual.itemType, expected.itemType, string.concat(key, ".itemType"));
  assertEqAddress(actual.token, expected.token, string.concat(key, ".token"));
  assertEqUint256(actual.identifierOrCriteria, expected.identifierOrCriteria, string.concat(key, ".identifierOrCriteria"));
  assertEqUint256(actual.startAmount, expected.startAmount, string.concat(key, ".startAmount"));
  assertEqUint256(actual.endAmount, expected.endAmount, string.concat(key, ".endAmount"));
  assertEqAddress(actual.recipient, expected.recipient, string.concat(key, ".recipient"));
}
function assertEqDynArrayConsiderationItem(ConsiderationItem[] memory actual, ConsiderationItem[] memory expected, string memory key) internal {
  uint256 length = actual.length;
  assertEq(length, expected.length, string.concat(key, ".length"));
  for (uint256 i; i < length; i++) {
    assertEqConsiderationItem(actual[i], expected[i], string.concat(key, "[", i.toString(), "]"));
  }
}
function assertEqOrderType(OrderType actual, OrderType expected, string memory key) internal {
  string[5] memory members = [
    "FULL_OPEN",
    "PARTIAL_OPEN",
    "FULL_RESTRICTED",
    "PARTIAL_RESTRICTED",
    "CONTRACT"
  ];
  assertEq(members[uint256(actual)], members[uint256(expected)], key);
}
function assertEqBytes32(bytes32 actual, bytes32 expected, string memory key) internal {
  return assertEq(actual, expected, key);
}
function assertEqOrderComponents(OrderComponents memory actual, OrderComponents memory expected, string memory key) internal {
  assertEqAddress(actual.offerer, expected.offerer, string.concat(key, ".offerer"));
  assertEqAddress(actual.zone, expected.zone, string.concat(key, ".zone"));
  assertEqDynArrayOfferItem(actual.offer, expected.offer, string.concat(key, ".offer"));
  assertEqDynArrayConsiderationItem(actual.consideration, expected.consideration, string.concat(key, ".consideration"));
  assertEqOrderType(actual.orderType, expected.orderType, string.concat(key, ".orderType"));
  assertEqUint256(actual.startTime, expected.startTime, string.concat(key, ".startTime"));
  assertEqUint256(actual.endTime, expected.endTime, string.concat(key, ".endTime"));
  assertEqBytes32(actual.zoneHash, expected.zoneHash, string.concat(key, ".zoneHash"));
  assertEqUint256(actual.salt, expected.salt, string.concat(key, ".salt"));
  assertEqBytes32(actual.conduitKey, expected.conduitKey, string.concat(key, ".conduitKey"));
  assertEqUint256(actual.counter, expected.counter, string.concat(key, ".counter"));
}
function assertEqSpentItem(SpentItem memory actual, SpentItem memory expected, string memory key) internal {
  assertEqItemType(actual.itemType, expected.itemType, string.concat(key, ".itemType"));
  assertEqAddress(actual.token, expected.token, string.concat(key, ".token"));
  assertEqUint256(actual.identifier, expected.identifier, string.concat(key, ".identifier"));
  assertEqUint256(actual.amount, expected.amount, string.concat(key, ".amount"));
}
function assertEqReceivedItem(ReceivedItem memory actual, ReceivedItem memory expected, string memory key) internal {
  assertEqItemType(actual.itemType, expected.itemType, string.concat(key, ".itemType"));
  assertEqAddress(actual.token, expected.token, string.concat(key, ".token"));
  assertEqUint256(actual.identifier, expected.identifier, string.concat(key, ".identifier"));
  assertEqUint256(actual.amount, expected.amount, string.concat(key, ".amount"));
  assertEqAddress(actual.recipient, expected.recipient, string.concat(key, ".recipient"));
}
function assertEqBasicOrderType(BasicOrderType actual, BasicOrderType expected, string memory key) internal {
  string[24] memory members = [
    "ETH_TO_ERC721_FULL_OPEN",
    "ETH_TO_ERC721_PARTIAL_OPEN",
    "ETH_TO_ERC721_FULL_RESTRICTED",
    "ETH_TO_ERC721_PARTIAL_RESTRICTED",
    "ETH_TO_ERC1155_FULL_OPEN",
    "ETH_TO_ERC1155_PARTIAL_OPEN",
    "ETH_TO_ERC1155_FULL_RESTRICTED",
    "ETH_TO_ERC1155_PARTIAL_RESTRICTED",
    "ERC20_TO_ERC721_FULL_OPEN",
    "ERC20_TO_ERC721_PARTIAL_OPEN",
    "ERC20_TO_ERC721_FULL_RESTRICTED",
    "ERC20_TO_ERC721_PARTIAL_RESTRICTED",
    "ERC20_TO_ERC1155_FULL_OPEN",
    "ERC20_TO_ERC1155_PARTIAL_OPEN",
    "ERC20_TO_ERC1155_FULL_RESTRICTED",
    "ERC20_TO_ERC1155_PARTIAL_RESTRICTED",
    "ERC721_TO_ERC20_FULL_OPEN",
    "ERC721_TO_ERC20_PARTIAL_OPEN",
    "ERC721_TO_ERC20_FULL_RESTRICTED",
    "ERC721_TO_ERC20_PARTIAL_RESTRICTED",
    "ERC1155_TO_ERC20_FULL_OPEN",
    "ERC1155_TO_ERC20_PARTIAL_OPEN",
    "ERC1155_TO_ERC20_FULL_RESTRICTED",
    "ERC1155_TO_ERC20_PARTIAL_RESTRICTED"
  ];
  assertEq(members[uint256(actual)], members[uint256(expected)], key);
}
function assertEqAdditionalRecipient(AdditionalRecipient memory actual, AdditionalRecipient memory expected, string memory key) internal {
  assertEqUint256(actual.amount, expected.amount, string.concat(key, ".amount"));
  assertEqAddress(actual.recipient, expected.recipient, string.concat(key, ".recipient"));
}
function assertEqDynArrayAdditionalRecipient(AdditionalRecipient[] memory actual, AdditionalRecipient[] memory expected, string memory key) internal {
  uint256 length = actual.length;
  assertEq(length, expected.length, string.concat(key, ".length"));
  for (uint256 i; i < length; i++) {
    assertEqAdditionalRecipient(actual[i], expected[i], string.concat(key, "[", i.toString(), "]"));
  }
}
function assertEqBytes(bytes memory actual, bytes memory expected, string memory key) internal {
  return assertEq(actual, expected, key);
}
function assertEqBasicOrderParameters(BasicOrderParameters memory actual, BasicOrderParameters memory expected, string memory key) internal {
  assertEqAddress(actual.considerationToken, expected.considerationToken, string.concat(key, ".considerationToken"));
  assertEqUint256(actual.considerationIdentifier, expected.considerationIdentifier, string.concat(key, ".considerationIdentifier"));
  assertEqUint256(actual.considerationAmount, expected.considerationAmount, string.concat(key, ".considerationAmount"));
  assertEqAddress(actual.offerer, expected.offerer, string.concat(key, ".offerer"));
  assertEqAddress(actual.zone, expected.zone, string.concat(key, ".zone"));
  assertEqAddress(actual.offerToken, expected.offerToken, string.concat(key, ".offerToken"));
  assertEqUint256(actual.offerIdentifier, expected.offerIdentifier, string.concat(key, ".offerIdentifier"));
  assertEqUint256(actual.offerAmount, expected.offerAmount, string.concat(key, ".offerAmount"));
  assertEqBasicOrderType(actual.basicOrderType, expected.basicOrderType, string.concat(key, ".basicOrderType"));
  assertEqUint256(actual.startTime, expected.startTime, string.concat(key, ".startTime"));
  assertEqUint256(actual.endTime, expected.endTime, string.concat(key, ".endTime"));
  assertEqBytes32(actual.zoneHash, expected.zoneHash, string.concat(key, ".zoneHash"));
  assertEqUint256(actual.salt, expected.salt, string.concat(key, ".salt"));
  assertEqBytes32(actual.offererConduitKey, expected.offererConduitKey, string.concat(key, ".offererConduitKey"));
  assertEqBytes32(actual.fulfillerConduitKey, expected.fulfillerConduitKey, string.concat(key, ".fulfillerConduitKey"));
  assertEqUint256(actual.totalOriginalAdditionalRecipients, expected.totalOriginalAdditionalRecipients, string.concat(key, ".totalOriginalAdditionalRecipients"));
  assertEqDynArrayAdditionalRecipient(actual.additionalRecipients, expected.additionalRecipients, string.concat(key, ".additionalRecipients"));
  assertEqBytes(actual.signature, expected.signature, string.concat(key, ".signature"));
}
function assertEqOrderParameters(OrderParameters memory actual, OrderParameters memory expected, string memory key) internal {
  assertEqAddress(actual.offerer, expected.offerer, string.concat(key, ".offerer"));
  assertEqAddress(actual.zone, expected.zone, string.concat(key, ".zone"));
  assertEqDynArrayOfferItem(actual.offer, expected.offer, string.concat(key, ".offer"));
  assertEqDynArrayConsiderationItem(actual.consideration, expected.consideration, string.concat(key, ".consideration"));
  assertEqOrderType(actual.orderType, expected.orderType, string.concat(key, ".orderType"));
  assertEqUint256(actual.startTime, expected.startTime, string.concat(key, ".startTime"));
  assertEqUint256(actual.endTime, expected.endTime, string.concat(key, ".endTime"));
  assertEqBytes32(actual.zoneHash, expected.zoneHash, string.concat(key, ".zoneHash"));
  assertEqUint256(actual.salt, expected.salt, string.concat(key, ".salt"));
  assertEqBytes32(actual.conduitKey, expected.conduitKey, string.concat(key, ".conduitKey"));
  assertEqUint256(actual.totalOriginalConsiderationItems, expected.totalOriginalConsiderationItems, string.concat(key, ".totalOriginalConsiderationItems"));
}
function assertEqOrder(Order memory actual, Order memory expected, string memory key) internal {
  assertEqOrderParameters(actual.parameters, expected.parameters, string.concat(key, ".parameters"));
  assertEqBytes(actual.signature, expected.signature, string.concat(key, ".signature"));
}
function assertEqAdvancedOrder(AdvancedOrder memory actual, AdvancedOrder memory expected, string memory key) internal {
  assertEqOrderParameters(actual.parameters, expected.parameters, string.concat(key, ".parameters"));
  assertEqUint256(actual.numerator, expected.numerator, string.concat(key, ".numerator"));
  assertEqUint256(actual.denominator, expected.denominator, string.concat(key, ".denominator"));
  assertEqBytes(actual.signature, expected.signature, string.concat(key, ".signature"));
  assertEqBytes(actual.extraData, expected.extraData, string.concat(key, ".extraData"));
}
function assertEqBool(bool actual, bool expected, string memory key) internal {
  return assertEq(actual, expected, key);
}
function assertEqOrderStatus(OrderStatus memory actual, OrderStatus memory expected, string memory key) internal {
  assertEqBool(actual.isValidated, expected.isValidated, string.concat(key, ".isValidated"));
  assertEqBool(actual.isCancelled, expected.isCancelled, string.concat(key, ".isCancelled"));
  assertEqUint256(actual.numerator, expected.numerator, string.concat(key, ".numerator"));
  assertEqUint256(actual.denominator, expected.denominator, string.concat(key, ".denominator"));
}
function assertEqSide(Side actual, Side expected, string memory key) internal {
  string[2] memory members = [
    "OFFER",
    "CONSIDERATION"
  ];
  assertEq(members[uint256(actual)], members[uint256(expected)], key);
}
function assertEqDynArrayBytes32(bytes32[] memory actual, bytes32[] memory expected, string memory key) internal {
  return assertEq(actual, expected, key);
}
function assertEqCriteriaResolver(CriteriaResolver memory actual, CriteriaResolver memory expected, string memory key) internal {
  assertEqUint256(actual.orderIndex, expected.orderIndex, string.concat(key, ".orderIndex"));
  assertEqSide(actual.side, expected.side, string.concat(key, ".side"));
  assertEqUint256(actual.index, expected.index, string.concat(key, ".index"));
  assertEqUint256(actual.identifier, expected.identifier, string.concat(key, ".identifier"));
  assertEqDynArrayBytes32(actual.criteriaProof, expected.criteriaProof, string.concat(key, ".criteriaProof"));
}
function assertEqFulfillmentComponent(FulfillmentComponent memory actual, FulfillmentComponent memory expected, string memory key) internal {
  assertEqUint256(actual.orderIndex, expected.orderIndex, string.concat(key, ".orderIndex"));
  assertEqUint256(actual.itemIndex, expected.itemIndex, string.concat(key, ".itemIndex"));
}
function assertEqDynArrayFulfillmentComponent(FulfillmentComponent[] memory actual, FulfillmentComponent[] memory expected, string memory key) internal {
  uint256 length = actual.length;
  assertEq(length, expected.length, string.concat(key, ".length"));
  for (uint256 i; i < length; i++) {
    assertEqFulfillmentComponent(actual[i], expected[i], string.concat(key, "[", i.toString(), "]"));
  }
}
function assertEqFulfillment(Fulfillment memory actual, Fulfillment memory expected, string memory key) internal {
  assertEqDynArrayFulfillmentComponent(actual.offerComponents, expected.offerComponents, string.concat(key, ".offerComponents"));
  assertEqDynArrayFulfillmentComponent(actual.considerationComponents, expected.considerationComponents, string.concat(key, ".considerationComponents"));
}
function assertEqExecution(Execution memory actual, Execution memory expected, string memory key) internal {
  assertEqReceivedItem(actual.item, expected.item, string.concat(key, ".item"));
  assertEqAddress(actual.offerer, expected.offerer, string.concat(key, ".offerer"));
  assertEqBytes32(actual.conduitKey, expected.conduitKey, string.concat(key, ".conduitKey"));
}
function assertEqDynArraySpentItem(SpentItem[] memory actual, SpentItem[] memory expected, string memory key) internal {
  uint256 length = actual.length;
  assertEq(length, expected.length, string.concat(key, ".length"));
  for (uint256 i; i < length; i++) {
    assertEqSpentItem(actual[i], expected[i], string.concat(key, "[", i.toString(), "]"));
  }
}
function assertEqDynArrayReceivedItem(ReceivedItem[] memory actual, ReceivedItem[] memory expected, string memory key) internal {
  uint256 length = actual.length;
  assertEq(length, expected.length, string.concat(key, ".length"));
  for (uint256 i; i < length; i++) {
    assertEqReceivedItem(actual[i], expected[i], string.concat(key, "[", i.toString(), "]"));
  }
}
function assertEqZoneParameters(ZoneParameters memory actual, ZoneParameters memory expected, string memory key) internal {
  assertEqBytes32(actual.orderHash, expected.orderHash, string.concat(key, ".orderHash"));
  assertEqAddress(actual.fulfiller, expected.fulfiller, string.concat(key, ".fulfiller"));
  assertEqAddress(actual.offerer, expected.offerer, string.concat(key, ".offerer"));
  assertEqDynArraySpentItem(actual.offer, expected.offer, string.concat(key, ".offer"));
  assertEqDynArrayReceivedItem(actual.consideration, expected.consideration, string.concat(key, ".consideration"));
  assertEqBytes(actual.extraData, expected.extraData, string.concat(key, ".extraData"));
  assertEqDynArrayBytes32(actual.orderHashes, expected.orderHashes, string.concat(key, ".orderHashes"));
  assertEqUint256(actual.startTime, expected.startTime, string.concat(key, ".startTime"));
  assertEqUint256(actual.endTime, expected.endTime, string.concat(key, ".endTime"));
  assertEqBytes32(actual.zoneHash, expected.zoneHash, string.concat(key, ".zoneHash"));
}
}