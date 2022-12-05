pragma solidity ^0.8.13;

import { ConduitInterface } from "../interfaces/ConduitInterface.sol";
import { OrderType, ItemType, BasicOrderRouteType } from "./ConsiderationEnums.sol";
import { AdditionalRecipient, BasicOrderParameters, OfferItem, ConsiderationItem, SpentItem, ReceivedItem } from "./ConsiderationStructs.sol";
import { OrderValidator } from "./OrderValidator.sol";
import "./ConsiderationErrors.sol";

///  @title BasicOrderFulfiller
///  @author 0age
///  @notice BasicOrderFulfiller contains functionality for fulfilling "basic"
///          orders with minimal overhead. See documentation for details on what
///          qualifies as a basic order.
contract BasicOrderFulfiller is OrderValidator {
  ///  @dev Derive and set hashes, reference chainId, and associated domain
  ///       separator during deployment.
  ///  @param conduitController A contract that deploys conduits, or proxies
  ///                           that may optionally be used to transfer approved
  ///                           ERC20/721/1155 tokens.
  constructor(address conduitController) OrderValidator(conduitController) {}

  ///  @dev Internal function to fulfill an order offering an ERC20, ERC721, or
  ///       ERC1155 item by supplying Ether (or other native tokens), ERC20
  ///       tokens, an ERC721 item, or an ERC1155 item as consideration. Six
  ///       permutations are supported: Native token to ERC721, Native token to
  ///       ERC1155, ERC20 to ERC721, ERC20 to ERC1155, ERC721 to ERC20, and
  ///       ERC1155 to ERC20 (with native tokens supplied as msg.value). For an
  ///       order to be eligible for fulfillment via this method, it must
  ///       contain a single offer item (though that item may have a greater
  ///       amount if the item is not an ERC721). An arbitrary number of
  ///       "additional recipients" may also be supplied which will each receive
  ///       native tokens or ERC20 items from the fulfiller as consideration.
  ///       Refer to the documentation for a more comprehensive summary of how
  ///       to utilize this method and what orders are compatible with it.
  ///  @param parameters Additional information on the fulfilled order. Note
  ///                    that the offerer and the fulfiller must first approve
  ///                    this contract (or their chosen conduit if indicated)
  ///                    before any tokens can be transferred. Also note that
  ///                    contract recipients of ERC1155 consideration items must
  ///                    implement `onERC1155Received` in order to receive those
  ///                    items.
  ///  @return A boolean indicating whether the order has been fulfilled.
  function _validateAndFulfillBasicOrder(BasicOrderParameters calldata parameters) internal returns (bool) {
    BasicOrderRouteType route;
    OrderType orderType;
    ItemType additionalRecipientsItemType;
    bytes32 orderHash;
    assembly {
      let basicOrderType := calldataload(BasicOrder_basicOrderType_cdPtr)
      orderType := and(basicOrderType, 3)
      route := shr(2, basicOrderType)
      additionalRecipientsItemType := gt(route, 1)
    }
    {
      bool correctPayableStatus;
      assembly {
        correctPayableStatus := eq(additionalRecipientsItemType, iszero(callvalue()))
      }
      if (!correctPayableStatus) {
        _revertInvalidMsgValue(msg.value);
      }
    }
    address additionalRecipientsToken;
    ItemType offeredItemType;
    bool offerTypeIsAdditionalRecipientsType;
    {
      ItemType receivedItemType;
      assembly {
        offerTypeIsAdditionalRecipientsType := gt(route, 3)
        additionalRecipientsToken := calldataload(add(BasicOrder_considerationToken_cdPtr, mul(offerTypeIsAdditionalRecipientsType, BasicOrder_common_params_size)))
        receivedItemType := add(mul(sub(route, 2), gt(route, 2)), eq(route, 2))
        offeredItemType := sub(add(route, mul(iszero(additionalRecipientsItemType), 2)), mul(offerTypeIsAdditionalRecipientsType, add(receivedItemType, 1)))
      }
      orderHash = _prepareBasicFulfillmentFromCalldata(parameters, orderType, receivedItemType, additionalRecipientsItemType, additionalRecipientsToken, offeredItemType);
    }
    bytes32 conduitKey;
    assembly {
      conduitKey := calldataload(add(BasicOrder_offererConduit_cdPtr, mul(offerTypeIsAdditionalRecipientsType, OneWord)))
    }
    if (additionalRecipientsItemType == ItemType.NATIVE) {
      if ((uint160(parameters.considerationToken) | parameters.considerationIdentifier) != 0) {
        _revertUnusedItemParameters();
      }
      _transferIndividual721Or1155Item(offeredItemType, parameters.offerToken, parameters.offerer, msg.sender, parameters.offerIdentifier, parameters.offerAmount, conduitKey);
      _transferEthAndFinalize(parameters.considerationAmount, parameters.offerer, parameters.additionalRecipients);
    } else {
      bytes memory accumulator = new bytes(AccumulatorDisarmed);
      if (route == BasicOrderRouteType.ERC20_TO_ERC721) {
        _transferERC721(parameters.offerToken, parameters.offerer, msg.sender, parameters.offerIdentifier, parameters.offerAmount, conduitKey, accumulator);
      } else if (route == BasicOrderRouteType.ERC20_TO_ERC1155) {
        _transferERC1155(parameters.offerToken, parameters.offerer, msg.sender, parameters.offerIdentifier, parameters.offerAmount, conduitKey, accumulator);
      } else if (route == BasicOrderRouteType.ERC721_TO_ERC20) {
        _transferERC721(parameters.considerationToken, msg.sender, parameters.offerer, parameters.considerationIdentifier, parameters.considerationAmount, conduitKey, accumulator);
      } else {
        _transferERC1155(parameters.considerationToken, msg.sender, parameters.offerer, parameters.considerationIdentifier, parameters.considerationAmount, conduitKey, accumulator);
      }
      _transferERC20AndFinalize(parameters.offerer, parameters, offerTypeIsAdditionalRecipientsType, accumulator);
      _triggerIfArmed(accumulator);
    }
    _assertRestrictedBasicOrderValidity(orderHash, orderType, parameters);
    _clearReentrancyGuard();
    return true;
  }

  ///  @dev Internal function to prepare fulfillment of a basic order with
  ///       manual calldata and memory access. This calculates the order hash,
  ///       emits an OrderFulfilled event, and asserts basic order validity.
  ///       Note that calldata offsets must be validated as this function
  ///       accesses constant calldata pointers for dynamic types that match
  ///       default ABI encoding, but valid ABI encoding can use arbitrary
  ///       offsets. Checking that the offsets were produced by default encoding
  ///       will ensure that other functions using Solidity's calldata accessors
  ///       (which calculate pointers from the stored offsets) are reading the
  ///       same data as the order hash is derived from. Also note that This
  ///       function accesses memory directly.
  ///  @param parameters                   The parameters of the basic order.
  ///  @param orderType                    The order type.
  ///  @param receivedItemType             The item type of the initial
  ///                                      consideration item on the order.
  ///  @param additionalRecipientsItemType The item type of any additional
  ///                                      consideration item on the order.
  ///  @param additionalRecipientsToken    The ERC20 token contract address (if
  ///                                      applicable) for any additional
  ///                                      consideration item on the order.
  ///  @param offeredItemType              The item type of the offered item on
  ///                                      the order.
  function _prepareBasicFulfillmentFromCalldata(BasicOrderParameters calldata parameters, OrderType orderType, ItemType receivedItemType, ItemType additionalRecipientsItemType, address additionalRecipientsToken, ItemType offeredItemType) internal returns (bytes32 orderHash) {
    _setReentrancyGuard();
    _verifyTime(parameters.startTime, parameters.endTime, true);
    _assertValidBasicOrderParameters();
    _assertConsiderationLengthIsNotLessThanOriginalConsiderationLength(parameters.additionalRecipients.length, parameters.totalOriginalAdditionalRecipients);
    {
      ///  First, handle consideration items. Memory Layout:
      ///   0x60: final hash of the array of consideration item hashes
      ///   0x80-0x160: reused space for EIP712 hashing of each item
      ///    - 0x80: ConsiderationItem EIP-712 typehash (constant)
      ///    - 0xa0: itemType
      ///    - 0xc0: token
      ///    - 0xe0: identifier
      ///    - 0x100: startAmount
      ///    - 0x120: endAmount
      ///    - 0x140: recipient
      ///   0x160-END_ARR: array of consideration item hashes
      ///    - 0x160: primary consideration item EIP712 hash
      ///    - 0x180-END_ARR: additional recipient item EIP712 hashes
      ///   END_ARR: beginning of data for OrderFulfilled event
      ///    - END_ARR + 0x120: length of ReceivedItem array
      ///    - END_ARR + 0x140: beginning of data for first ReceivedItem
      ///  (Note: END_ARR = 0x180 + RECIPIENTS_LENGTH * 0x20)
      bytes32 typeHash = _CONSIDERATION_ITEM_TYPEHASH;
      assembly {
        mstore(BasicOrder_considerationItem_typeHash_ptr, typeHash)
        mstore(BasicOrder_considerationItem_itemType_ptr, receivedItemType)
        calldatacopy(BasicOrder_considerationItem_token_ptr, BasicOrder_considerationToken_cdPtr, ThreeWords)
        calldatacopy(BasicOrder_considerationItem_endAmount_ptr, BasicOrder_considerationAmount_cdPtr, TwoWords)
        mstore(BasicOrder_considerationHashesArray_ptr, keccak256(BasicOrder_considerationItem_typeHash_ptr, EIP712_ConsiderationItem_size))
        let totalAdditionalRecipients := calldataload(BasicOrder_additionalRecipients_length_cdPtr)
        let eventConsiderationArrPtr := add(OrderFulfilled_consideration_length_baseOffset, mul(totalAdditionalRecipients, OneWord))
        mstore(eventConsiderationArrPtr, add(calldataload(BasicOrder_additionalRecipients_length_cdPtr), 1))
        eventConsiderationArrPtr := add(eventConsiderationArrPtr, OneWord)
        mstore(eventConsiderationArrPtr, receivedItemType)
        calldatacopy(add(eventConsiderationArrPtr, Common_token_offset), BasicOrder_considerationToken_cdPtr, FourWords)
        let considerationHashesPtr := BasicOrder_considerationHashesArray_ptr
        mstore(BasicOrder_considerationItem_itemType_ptr, additionalRecipientsItemType)
        mstore(BasicOrder_considerationItem_token_ptr, additionalRecipientsToken)
        mstore(BasicOrder_considerationItem_identifier_ptr, 0)
        totalAdditionalRecipients := calldataload(BasicOrder_totalOriginalAdditionalRecipients_cdPtr)
        let i := 0
        for {} lt(i, totalAdditionalRecipients) {
          i := add(i, 1)
        } {
          let additionalRecipientCdPtr := add(BasicOrder_additionalRecipients_data_cdPtr, mul(AdditionalRecipients_size, i))
          calldatacopy(BasicOrder_considerationItem_startAmount_ptr, additionalRecipientCdPtr, OneWord)
          calldatacopy(BasicOrder_considerationItem_endAmount_ptr, additionalRecipientCdPtr, AdditionalRecipients_size)
          considerationHashesPtr := add(considerationHashesPtr, OneWord)
          mstore(considerationHashesPtr, keccak256(BasicOrder_considerationItem_typeHash_ptr, EIP712_ConsiderationItem_size))
          eventConsiderationArrPtr := add(eventConsiderationArrPtr, ReceivedItem_size)
          mstore(eventConsiderationArrPtr, additionalRecipientsItemType)
          mstore(add(eventConsiderationArrPtr, OneWord), additionalRecipientsToken)
          calldatacopy(add(eventConsiderationArrPtr, ReceivedItem_amount_offset), additionalRecipientCdPtr, TwoWords)
        }
        mstore(receivedItemsHash_ptr, keccak256(BasicOrder_considerationHashesArray_ptr, mul(add(totalAdditionalRecipients, 1), OneWord)))
        totalAdditionalRecipients := calldataload(BasicOrder_additionalRecipients_length_cdPtr)
        for {} lt(i, totalAdditionalRecipients) {
          i := add(i, 1)
        } {
          let additionalRecipientCdPtr := add(BasicOrder_additionalRecipients_data_cdPtr, mul(AdditionalRecipients_size, i))
          eventConsiderationArrPtr := add(eventConsiderationArrPtr, ReceivedItem_size)
          mstore(eventConsiderationArrPtr, additionalRecipientsItemType)
          mstore(add(eventConsiderationArrPtr, OneWord), additionalRecipientsToken)
          calldatacopy(add(eventConsiderationArrPtr, ReceivedItem_amount_offset), additionalRecipientCdPtr, TwoWords)
        }
      }
    }
    {
      ///  Next, handle offered items. Memory Layout:
      ///   EIP712 data for OfferItem
      ///    - 0x80:  OfferItem EIP-712 typehash (constant)
      ///    - 0xa0:  itemType
      ///    - 0xc0:  token
      ///    - 0xe0:  identifier (reused for offeredItemsHash)
      ///    - 0x100: startAmount
      ///    - 0x120: endAmount
      bytes32 typeHash = _OFFER_ITEM_TYPEHASH;
      assembly {
        mstore(BasicOrder_offerItem_typeHash_ptr, typeHash)
        mstore(BasicOrder_offerItem_itemType_ptr, offeredItemType)
        calldatacopy(BasicOrder_offerItem_token_ptr, BasicOrder_offerToken_cdPtr, ThreeWords)
        calldatacopy(BasicOrder_offerItem_endAmount_ptr, BasicOrder_offerAmount_cdPtr, OneWord)
        mstore(0, keccak256(BasicOrder_offerItem_typeHash_ptr, EIP712_OfferItem_size))
        mstore(BasicOrder_order_offerHashes_ptr, keccak256(0, OneWord))
        let eventConsiderationArrPtr := add(OrderFulfilled_offer_length_baseOffset, mul(calldataload(BasicOrder_additionalRecipients_length_cdPtr), OneWord))
        mstore(eventConsiderationArrPtr, 1)
        mstore(add(eventConsiderationArrPtr, OneWord), offeredItemType)
        calldatacopy(add(eventConsiderationArrPtr, AdditionalRecipients_size), BasicOrder_offerToken_cdPtr, ThreeWords)
      }
    }
    {
      ///  Once consideration items and offer items have been handled,
      ///  derive the final order hash. Memory Layout:
      ///   0x80-0x1c0: EIP712 data for order
      ///    - 0x80:   Order EIP-712 typehash (constant)
      ///    - 0xa0:   orderParameters.offerer
      ///    - 0xc0:   orderParameters.zone
      ///    - 0xe0:   keccak256(abi.encodePacked(offerHashes))
      ///    - 0x100:  keccak256(abi.encodePacked(considerationHashes))
      ///    - 0x120:  orderParameters.basicOrderType (% 4 = orderType)
      ///    - 0x140:  orderParameters.startTime
      ///    - 0x160:  orderParameters.endTime
      ///    - 0x180:  orderParameters.zoneHash
      ///    - 0x1a0:  orderParameters.salt
      ///    - 0x1c0:  orderParameters.conduitKey
      ///    - 0x1e0:  _counters[orderParameters.offerer] (from storage)
      address offerer;
      assembly {
        offerer := calldataload(BasicOrder_offerer_cdPtr)
      }
      uint256 counter = _getCounter(offerer);
      bytes32 typeHash = _ORDER_TYPEHASH;
      assembly {
        mstore(BasicOrder_order_typeHash_ptr, typeHash)
        calldatacopy(BasicOrder_order_offerer_ptr, BasicOrder_offerer_cdPtr, TwoWords)
        mstore(BasicOrder_order_considerationHashes_ptr, mload(receivedItemsHash_ptr))
        mstore(BasicOrder_order_orderType_ptr, orderType)
        calldatacopy(BasicOrder_order_startTime_ptr, BasicOrder_startTime_cdPtr, FiveWords)
        mstore(BasicOrder_order_counter_ptr, counter)
        orderHash := keccak256(BasicOrder_order_typeHash_ptr, EIP712_Order_size)
      }
    }
    assembly {
      let eventDataPtr := add(OrderFulfilled_baseOffset, mul(calldataload(BasicOrder_additionalRecipients_length_cdPtr), OneWord))
      mstore(eventDataPtr, orderHash)
      mstore(add(eventDataPtr, OrderFulfilled_fulfiller_offset), caller())
      mstore(add(eventDataPtr, OrderFulfilled_offer_head_offset), OrderFulfilled_offer_body_offset)
      mstore(add(eventDataPtr, OrderFulfilled_consideration_head_offset), OrderFulfilled_consideration_body_offset)
      let dataSize := add(OrderFulfilled_baseSize, mul(calldataload(BasicOrder_additionalRecipients_length_cdPtr), ReceivedItem_size))
      log3(eventDataPtr, dataSize, OrderFulfilled_selector, calldataload(BasicOrder_offerer_cdPtr), calldataload(BasicOrder_zone_cdPtr))
      mstore(ZeroSlot, 0)
      mstore(0x40, add(0x80, add(eventDataPtr, dataSize)))
    }
    _validateBasicOrderAndUpdateStatus(orderHash, parameters.offerer, parameters.signature);
    return orderHash;
  }

  ///  @dev Internal function to transfer Ether (or other native tokens) to a
  ///       given recipient as part of basic order fulfillment. Note that
  ///       conduits are not utilized for native tokens as the transferred
  ///       amount must be provided as msg.value.
  ///  @param amount               The amount to transfer.
  ///  @param to                   The recipient of the native token transfer.
  ///  @param additionalRecipients The additional recipients of the order.
  function _transferEthAndFinalize(uint256 amount, address payable to, AdditionalRecipient[] calldata additionalRecipients) internal {
    uint256 etherRemaining = msg.value;
    uint256 totalAdditionalRecipients = additionalRecipients.length;
    unchecked {
      for (uint256 i = 0; i < totalAdditionalRecipients; ++i) {
        AdditionalRecipient calldata additionalRecipient = (additionalRecipients[i]);
        uint256 additionalRecipientAmount = additionalRecipient.amount;
        if (additionalRecipientAmount > etherRemaining) {
          _revertInsufficientEtherSupplied();
        }
        _transferEth(additionalRecipient.recipient, additionalRecipientAmount);
        etherRemaining -= additionalRecipientAmount;
      }
    }
    if (amount > etherRemaining) {
      _revertInsufficientEtherSupplied();
    }
    _transferEth(to, amount);
    if (etherRemaining > amount) {
      unchecked {
        _transferEth(payable(msg.sender), etherRemaining - amount);
      }
    }
  }

  ///  @dev Internal function to transfer ERC20 tokens to a given recipient as
  ///       part of basic order fulfillment.
  ///  @param offerer     The offerer of the fulfiller order.
  ///  @param parameters  The basic order parameters.
  ///  @param fromOfferer A boolean indicating whether to decrement amount from
  ///                     the offered amount.
  ///  @param accumulator An open-ended array that collects transfers to execute
  ///                     against a given conduit in a single call.
  function _transferERC20AndFinalize(address offerer, BasicOrderParameters calldata parameters, bool fromOfferer, bytes memory accumulator) internal {
    address from;
    address to;
    address token;
    uint256 amount;
    {
      uint256 identifier;
      if (fromOfferer) {
        from = offerer;
        to = msg.sender;
        token = parameters.offerToken;
        identifier = parameters.offerIdentifier;
        amount = parameters.offerAmount;
      } else {
        from = msg.sender;
        to = offerer;
        token = parameters.considerationToken;
        identifier = parameters.considerationIdentifier;
        amount = parameters.considerationAmount;
      }
      if (identifier != 0) {
        _revertUnusedItemParameters();
      }
    }
    bytes32 conduitKey;
    assembly {
      conduitKey := calldataload(sub(BasicOrder_fulfillerConduit_cdPtr, mul(fromOfferer, OneWord)))
    }
    uint256 totalAdditionalRecipients = (parameters.additionalRecipients.length);
    for (uint256 i = 0; i < totalAdditionalRecipients; ) {
      AdditionalRecipient calldata additionalRecipient = (parameters.additionalRecipients[i]);
      uint256 additionalRecipientAmount = additionalRecipient.amount;
      if (fromOfferer) {
        amount -= additionalRecipientAmount;
      }
      _transferERC20(token, from, additionalRecipient.recipient, additionalRecipientAmount, conduitKey, accumulator);
      unchecked {
        ++i;
      }
    }
    _transferERC20(token, from, to, amount, conduitKey, accumulator);
  }
}