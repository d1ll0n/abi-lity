pragma solidity ^0.8.13;
import { ZoneInterface } from "../interfaces/ZoneInterface.sol";
import { ContractOffererInterface } from "../interfaces/ContractOffererInterface.sol";
import { ItemType, OrderType } from "./ConsiderationEnums.sol";
import { AdvancedOrder, OrderParameters, BasicOrderParameters, AdditionalRecipient, ZoneParameters, OfferItem, ConsiderationItem, SpentItem, ReceivedItem } from "./ConsiderationStructs.sol";
import { ZoneInteractionErrors } from "../interfaces/ZoneInteractionErrors.sol";
import { LowLevelHelpers } from "./LowLevelHelpers.sol";
import "./ConsiderationConstants.sol";
import "./ConsiderationErrors.sol";

contract ZoneInteraction is ZoneInteractionErrors, LowLevelHelpers {

  function _assertRestrictedBasicOrderValidity(bytes32 orderHash, OrderType orderType, BasicOrderParameters calldata parameters) internal {
    if (uint256(orderType) < 2) {
      return;
    }
    bytes memory callData;
    bytes32[] memory orderHashes = new bytes32[](1);
    orderHashes[0] = orderHash;
    SpentItem[] memory offer = new SpentItem[](1);
    ReceivedItem[] memory consideration = new ReceivedItem[](parameters.additionalRecipients.length + 1);
    bytes memory extraData;
    uint256 size;
    unchecked {
      size = OrderFulfilled_baseDataSize + (parameters.additionalRecipients.length * ReceivedItem_size);
    }
    {
      uint256 offerDataOffset;
      assembly {
        offerDataOffset := add(OrderFulfilled_offer_length_baseOffset, mul(calldataload(BasicOrder_additionalRecipients_length_cdPtr), OneWord))
      }
      _call(IdentityPrecompile, offerDataOffset, size);
    }
    if (_isRestrictedAndCallerNotZone(orderType, parameters.zone)) {
      callData = _generateValidateCallData(orderHash, parameters.offerer, offer, consideration, extraData, orderHashes, parameters.startTime, parameters.endTime, parameters.zoneHash);
      assembly {
        returndatacopy(add(callData, ValidateOrder_offerDataOffset), 0, size)
      }
      _callAndCheckStatus(parameters.zone, orderHash, callData, ZoneInterface.validateOrder.selector, _revertInvalidRestrictedOrder);
    } else if (orderType == OrderType.CONTRACT) {
      callData = _generateRatifyCallData(orderHash, offer, consideration, extraData, orderHashes);
      assembly {
        returndatacopy(add(callData, RatifyOrder_offerDataOffset), 0, size)
      }
      _callAndCheckStatus(parameters.offerer, orderHash, callData, ContractOffererInterface.ratifyOrder.selector, _revertInvalidContractOrder);
    } else {
      return;
    }
  }

  function _assertRestrictedAdvancedOrderValidity(AdvancedOrder memory advancedOrder, bytes32[] memory orderHashes, bytes32 orderHash) internal {
    bytes memory callData;
    address target;
    bytes4 magicValue;
    function(bytes32) internal view errorHandler;
    OrderParameters memory parameters = advancedOrder.parameters;
    if (_isRestrictedAndCallerNotZone(parameters.orderType, parameters.zone)) {
      callData = _generateValidateCallData(orderHash, parameters.offerer, _convertOffer(parameters.offer), _convertConsideration(parameters.consideration), advancedOrder.extraData, orderHashes, parameters.startTime, parameters.endTime, parameters.zoneHash);
      target = parameters.zone;
      magicValue = ZoneInterface.validateOrder.selector;
      errorHandler = _revertInvalidRestrictedOrder;
    } else if (parameters.orderType == OrderType.CONTRACT) {
      callData = _generateRatifyCallData(orderHash, _convertOffer(parameters.offer), _convertConsideration(parameters.consideration), advancedOrder.extraData, orderHashes);
      target = parameters.offerer;
      magicValue = ContractOffererInterface.ratifyOrder.selector;
      errorHandler = _revertInvalidContractOrder;
    } else {
      return;
    }
    _callAndCheckStatus(target, orderHash, callData, magicValue, errorHandler);
  }
  function _isRestrictedAndCallerNotZone(OrderType orderType, address zone) internal view returns (bool mustValidate) {
    assembly {
      mustValidate := and(or(eq(orderType, 2), eq(orderType, 3)), iszero(eq(caller(), zone)))
    }
  }
  function _callAndCheckStatus(address target, bytes32 orderHash, bytes memory callData, bytes4 magicValue, function(bytes32) internal view errorHandler) internal {
    uint256 callDataMemoryPointer;
    assembly {
      callDataMemoryPointer := add(callData, OneWord)
    }
    if (!_call(target, callDataMemoryPointer, callData.length)) {
      _revertWithReasonIfOneIsReturned();
      errorHandler(orderHash);
    }
    if (_doesNotMatchMagic(magicValue)) {
      errorHandler(orderHash);
    }
  }
  function _generateValidateCallData(bytes32 orderHash, address offerer, SpentItem[] memory offer, ReceivedItem[] memory consideration, bytes memory extraData, bytes32[] memory orderHashes, uint256 startTime, uint256 endTime, bytes32 zoneHash) internal view returns (bytes memory) {
    return abi.encodeWithSelector(ZoneInterface.validateOrder.selector, ZoneParameters(orderHash, msg.sender, offerer, offer, consideration, extraData, orderHashes, startTime, endTime, zoneHash));
  }
  function _generateRatifyCallData(bytes32 orderHash, SpentItem[] memory offer, ReceivedItem[] memory consideration, bytes memory context, bytes32[] memory orderHashes) internal pure returns (bytes memory) {
    return abi.encodeWithSelector(ContractOffererInterface.ratifyOrder.selector, offer, consideration, context, orderHashes, uint96(uint256(orderHash)));
  }
  function _convertOffer(OfferItem[] memory offer) internal pure returns (SpentItem[] memory spentItems) {
    assembly {
      spentItems := offer
    }
  }
  function _convertConsideration(ConsiderationItem[] memory consideration) internal pure returns (ReceivedItem[] memory receivedItems) {
    assembly {
      receivedItems := consideration
    }
  }
}