pragma solidity ^0.8.13;
import { ConduitInterface } from "../interfaces/ConduitInterface.sol";
import { OrderType, ItemType, BasicOrderRouteType } from "./ConsiderationEnums.sol";
import { AdditionalRecipient, BasicOrderParameters, OfferItem, ConsiderationItem, SpentItem, ReceivedItem } from "./ConsiderationStructs.sol";
import { OrderValidator } from "./OrderValidator.sol";
import "./ConsiderationErrors.sol";

contract BasicOrderFulfiller is OrderValidator {

  constructor(address conduitController) OrderValidator(conduitController) {}

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

  function _prepareBasicFulfillmentFromCalldata(BasicOrderParameters calldata parameters, OrderType orderType, ItemType receivedItemType, ItemType additionalRecipientsItemType, address additionalRecipientsToken, ItemType offeredItemType) internal returns (bytes32 orderHash) {
    _setReentrancyGuard();
    _verifyTime(parameters.startTime, parameters.endTime, true);
    _assertValidBasicOrderParameters();
    _assertConsiderationLengthIsNotLessThanOriginalConsiderationLength(parameters.additionalRecipients.length, parameters.totalOriginalAdditionalRecipients);
    {

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