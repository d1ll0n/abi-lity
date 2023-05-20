// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/*//////////////////////////////////////////////////////////////////
                                enums
//////////////////////////////////////////////////////////////////*/
enum OrderType {  FULL_OPEN, PARTIAL_OPEN, FULL_RESTRICTED, PARTIAL_RESTRICTED, CONTRACT  }
enum BasicOrderType {  ETH_TO_ERC721_FULL_OPEN, ETH_TO_ERC721_PARTIAL_OPEN, ETH_TO_ERC721_FULL_RESTRICTED, ETH_TO_ERC721_PARTIAL_RESTRICTED, ETH_TO_ERC1155_FULL_OPEN, ETH_TO_ERC1155_PARTIAL_OPEN, ETH_TO_ERC1155_FULL_RESTRICTED, ETH_TO_ERC1155_PARTIAL_RESTRICTED, ERC20_TO_ERC721_FULL_OPEN, ERC20_TO_ERC721_PARTIAL_OPEN, ERC20_TO_ERC721_FULL_RESTRICTED, ERC20_TO_ERC721_PARTIAL_RESTRICTED, ERC20_TO_ERC1155_FULL_OPEN, ERC20_TO_ERC1155_PARTIAL_OPEN, ERC20_TO_ERC1155_FULL_RESTRICTED, ERC20_TO_ERC1155_PARTIAL_RESTRICTED, ERC721_TO_ERC20_FULL_OPEN, ERC721_TO_ERC20_PARTIAL_OPEN, ERC721_TO_ERC20_FULL_RESTRICTED, ERC721_TO_ERC20_PARTIAL_RESTRICTED, ERC1155_TO_ERC20_FULL_OPEN, ERC1155_TO_ERC20_PARTIAL_OPEN, ERC1155_TO_ERC20_FULL_RESTRICTED, ERC1155_TO_ERC20_PARTIAL_RESTRICTED  }
enum BasicOrderRouteType {  ETH_TO_ERC721, ETH_TO_ERC1155, ERC20_TO_ERC721, ERC20_TO_ERC1155, ERC721_TO_ERC20, ERC1155_TO_ERC20  }
enum ItemType {  NATIVE, ERC20, ERC721, ERC1155, ERC721_WITH_CRITERIA, ERC1155_WITH_CRITERIA  }
enum Side {  OFFER, CONSIDERATION  }
/*//////////////////////////////////////////////////////////////////
                               structs
//////////////////////////////////////////////////////////////////*/
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
  address recipient;
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
  address recipient;
}
struct BasicOrderParameters {
  address considerationToken;
  uint256 considerationIdentifier;
  uint256 considerationAmount;
  address offerer;
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
  address recipient;
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
struct Schema {
  uint256 id;
  bytes metadata;
}