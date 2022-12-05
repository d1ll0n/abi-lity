pragma solidity ^0.8.7;

import { OrderType, BasicOrderType, ItemType, Side } from "./ConsiderationEnums.sol";

struct OrderComponents {
  address offerer;
  address zone;
  OfferItem[] offer;
  ConsiderationItem[] consideration;
  OrderType orderType;
  uint256 startTime;
  uint256 endTime;
  bytes32 zoneHash;
  uint256 salt;
  bytes32 conduitKey;
  uint256 counter;
}

struct OfferItem {
  ItemType itemType;
  address token;
  uint256 identifierOrCriteria;
  uint256 startAmount;
  uint256 endAmount;
}

struct ConsiderationItem {
  ItemType itemType;
  address token;
  uint256 identifierOrCriteria;
  uint256 startAmount;
  uint256 endAmount;
  address payable recipient;
}

struct SpentItem {
  ItemType itemType;
  address token;
  uint256 identifier;
  uint256 amount;
}

struct ReceivedItem {
  ItemType itemType;
  address token;
  uint256 identifier;
  uint256 amount;
  address payable recipient;
}

struct BasicOrderParameters {
  address considerationToken;
  uint256 considerationIdentifier;
  uint256 considerationAmount;
  address payable offerer;
  address zone;
  address offerToken;
  uint256 offerIdentifier;
  uint256 offerAmount;
  BasicOrderType basicOrderType;
  uint256 startTime;
  uint256 endTime;
  bytes32 zoneHash;
  uint256 salt;
  bytes32 offererConduitKey;
  bytes32 fulfillerConduitKey;
  uint256 totalOriginalAdditionalRecipients;
  AdditionalRecipient[] additionalRecipients;
  bytes signature;
}

struct AdditionalRecipient {
  uint256 amount;
  address payable recipient;
}

struct OrderParameters {
  address offerer;
  address zone;
  OfferItem[] offer;
  ConsiderationItem[] consideration;
  OrderType orderType;
  uint256 startTime;
  uint256 endTime;
  bytes32 zoneHash;
  uint256 salt;
  bytes32 conduitKey;
  uint256 totalOriginalConsiderationItems;
}

struct Order {
  OrderParameters parameters;
  bytes signature;
}

struct AdvancedOrder {
  OrderParameters parameters;
  uint120 numerator;
  uint120 denominator;
  bytes signature;
  bytes extraData;
}

struct OrderStatus {
  bool isValidated;
  bool isCancelled;
  uint120 numerator;
  uint120 denominator;
}

struct CriteriaResolver {
  uint256 orderIndex;
  Side side;
  uint256 index;
  uint256 identifier;
  bytes32[] criteriaProof;
}

struct Fulfillment {
  FulfillmentComponent[] offerComponents;
  FulfillmentComponent[] considerationComponents;
}

struct FulfillmentComponent {
  uint256 orderIndex;
  uint256 itemIndex;
}

struct Execution {
  ReceivedItem item;
  address offerer;
  bytes32 conduitKey;
}

struct ZoneParameters {
  bytes32 orderHash;
  address fulfiller;
  address offerer;
  SpentItem[] offer;
  ReceivedItem[] consideration;
  bytes extraData;
  bytes32[] orderHashes;
  uint256 startTime;
  uint256 endTime;
  bytes32 zoneHash;
}