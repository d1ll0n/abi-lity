pragma solidity ^0.8.13;
import { Side, ItemType } from "./ConsiderationEnums.sol";
import { OfferItem, ConsiderationItem, ReceivedItem, OrderParameters, Fulfillment, FulfillmentComponent, Execution, Order, AdvancedOrder, CriteriaResolver } from "./ConsiderationStructs.sol";
import { OrderFulfiller } from "./OrderFulfiller.sol";
import { FulfillmentApplier } from "./FulfillmentApplier.sol";
import "./ConsiderationErrors.sol";

contract OrderCombiner is OrderFulfiller, FulfillmentApplier {

  constructor(address conduitController) OrderFulfiller(conduitController) {}

  function _fulfillAvailableAdvancedOrders(AdvancedOrder[] memory advancedOrders, CriteriaResolver[] memory criteriaResolvers, FulfillmentComponent[][] calldata offerFulfillments, FulfillmentComponent[][] calldata considerationFulfillments, bytes32 fulfillerConduitKey, address recipient, uint256 maximumFulfilled) internal returns (bool[] memory availableOrders, Execution[] memory executions) {
    bytes32[] memory orderHashes = _validateOrdersAndPrepareToFulfill(advancedOrders, criteriaResolvers, false, maximumFulfilled, recipient);
    (availableOrders, executions) = _executeAvailableFulfillments(advancedOrders, offerFulfillments, considerationFulfillments, fulfillerConduitKey, recipient, orderHashes);
    return (availableOrders, executions);
  }

  function _validateOrdersAndPrepareToFulfill(AdvancedOrder[] memory advancedOrders, CriteriaResolver[] memory criteriaResolvers, bool revertOnInvalid, uint256 maximumFulfilled, address recipient) internal returns (bytes32[] memory orderHashes) {
    _setReentrancyGuard();
    uint256 totalOrders = advancedOrders.length;
    orderHashes = new bytes32[](totalOrders);
    uint256 invalidNativeOfferItemErrorBuffer;
    assembly {
      invalidNativeOfferItemErrorBuffer := shl(1, gt(mod(shr(NumBitsAfterSelector, calldataload(0)), NonMatchSelector_MagicModulus), NonMatchSelector_MagicRemainder))
    }
    unchecked {
      for (uint256 i = 0; i < totalOrders; ++i) {
        AdvancedOrder memory advancedOrder = advancedOrders[i];
        if (maximumFulfilled == 0) {
          advancedOrder.numerator = 0;
          continue;
        }
        (bytes32 orderHash, uint256 numerator, uint256 denominator) = _validateOrderAndUpdateStatus(advancedOrder, revertOnInvalid);
        if (numerator == 0) {
          advancedOrder.numerator = 0;
          continue;
        }
        orderHashes[i] = orderHash;
        maximumFulfilled--;
        uint256 startTime = advancedOrder.parameters.startTime;
        uint256 endTime = advancedOrder.parameters.endTime;
        OfferItem[] memory offer = advancedOrder.parameters.offer;
        uint256 totalOfferItems = offer.length;
        for (uint256 j = 0; j < totalOfferItems; ++j) {
          OfferItem memory offerItem = offer[j];
          assembly {
            invalidNativeOfferItemErrorBuffer := or(invalidNativeOfferItemErrorBuffer, iszero(mload(offerItem)))
          }
          uint256 endAmount = _getFraction(numerator, denominator, offerItem.endAmount);
          if (offerItem.startAmount == offerItem.endAmount) {
            offerItem.startAmount = endAmount;
          } else {
            offerItem.startAmount = _getFraction(numerator, denominator, offerItem.startAmount);
          }
          uint256 currentAmount = _locateCurrentAmount(offerItem.startAmount, endAmount, startTime, endTime, false);
          offerItem.startAmount = currentAmount;
          offerItem.endAmount = currentAmount;
        }
        ConsiderationItem[] memory consideration = (advancedOrder.parameters.consideration);
        uint256 totalConsiderationItems = consideration.length;
        for (uint256 j = 0; j < totalConsiderationItems; ++j) {
          ConsiderationItem memory considerationItem = (consideration[j]);
          uint256 endAmount = _getFraction(numerator, denominator, considerationItem.endAmount);
          if (considerationItem.startAmount == considerationItem.endAmount) {
            considerationItem.startAmount = endAmount;
          } else {
            considerationItem.startAmount = _getFraction(numerator, denominator, considerationItem.startAmount);
          }
          uint256 currentAmount = (_locateCurrentAmount(considerationItem.startAmount, endAmount, startTime, endTime, true));
          considerationItem.startAmount = currentAmount;
          assembly {
            mstore(add(considerationItem, ReceivedItem_recipient_offset), mload(add(considerationItem, ConsiderationItem_recipient_offset)))
          }
          assembly {
            mstore(add(considerationItem, ConsiderationItem_recipient_offset), mload(add(considerationItem, ReceivedItem_amount_offset)))
          }
        }
      }
    }
    if (invalidNativeOfferItemErrorBuffer == 3) {
      _revertInvalidNativeOfferItem();
    }
    _applyCriteriaResolvers(advancedOrders, criteriaResolvers);
    unchecked {
      for (uint256 i = 0; i < totalOrders; ++i) {
        if (orderHashes[i] == bytes32(0)) {
          continue;
        }
        OrderParameters memory orderParameters = (advancedOrders[i].parameters);
        _emitOrderFulfilledEvent(orderHashes[i], orderParameters.offerer, orderParameters.zone, recipient, orderParameters.offer, orderParameters.consideration);
      }
    }
  }

  function _executeAvailableFulfillments(AdvancedOrder[] memory advancedOrders, FulfillmentComponent[][] memory offerFulfillments, FulfillmentComponent[][] memory considerationFulfillments, bytes32 fulfillerConduitKey, address recipient, bytes32[] memory orderHashes) internal returns (bool[] memory availableOrders, Execution[] memory executions) {
    uint256 totalOfferFulfillments = offerFulfillments.length;
    uint256 totalConsiderationFulfillments = (considerationFulfillments.length);
    executions = new Execution[](totalOfferFulfillments + totalConsiderationFulfillments);
    unchecked {
      uint256 totalFilteredExecutions = 0;
      for (uint256 i = 0; i < totalOfferFulfillments; ++i) {
        FulfillmentComponent[] memory components = (offerFulfillments[i]);
        Execution memory execution = _aggregateAvailable(advancedOrders, Side.OFFER, components, fulfillerConduitKey, recipient);
        if (_unmaskedAddressComparison(execution.item.recipient, execution.offerer)) {
          ++totalFilteredExecutions;
        } else {
          executions[i - totalFilteredExecutions] = execution;
        }
      }
      for (uint256 i = 0; i < totalConsiderationFulfillments; ++i) {
        FulfillmentComponent[] memory components = (considerationFulfillments[i]);
        Execution memory execution = _aggregateAvailable(advancedOrders, Side.CONSIDERATION, components, fulfillerConduitKey, address(0));
        if (_unmaskedAddressComparison(execution.item.recipient, execution.offerer)) {
          ++totalFilteredExecutions;
        } else {
          executions[(i + totalOfferFulfillments) - totalFilteredExecutions] = execution;
        }
      }
      if (totalFilteredExecutions != 0) {
        assembly {
          mstore(executions, sub(mload(executions), totalFilteredExecutions))
        }
      }
    }
    if (executions.length == 0) {
      _revertNoSpecifiedOrdersAvailable();
    }
    availableOrders = _performFinalChecksAndExecuteOrders(advancedOrders, executions, orderHashes);
    return (availableOrders, executions);
  }

  function _performFinalChecksAndExecuteOrders(AdvancedOrder[] memory advancedOrders, Execution[] memory executions, bytes32[] memory orderHashes) internal returns (bool[] memory availableOrders) {
    uint256 etherRemaining = msg.value;
    bytes memory accumulator = new bytes(AccumulatorDisarmed);
    uint256 totalExecutions = executions.length;
    for (uint256 i = 0; i < totalExecutions; ) {
      Execution memory execution = executions[i];
      ReceivedItem memory item = execution.item;
      if (item.itemType == ItemType.NATIVE) {
        if (item.amount > etherRemaining) {
          _revertInsufficientEtherSupplied();
        }
        unchecked {
          etherRemaining -= item.amount;
        }
      }
      _transfer(item, execution.offerer, execution.conduitKey, accumulator);
      unchecked {
        ++i;
      }
    }
    _triggerIfArmed(accumulator);
    if (etherRemaining != 0) {
      _transferEth(payable(msg.sender), etherRemaining);
    }
    uint256 totalOrders = advancedOrders.length;
    availableOrders = new bool[](totalOrders);
    unchecked {
      for (uint256 i = 0; i < totalOrders; ++i) {
        AdvancedOrder memory advancedOrder = advancedOrders[i];
        if (advancedOrder.numerator == 0) {
          continue;
        }
        availableOrders[i] = true;
        OrderParameters memory parameters = advancedOrder.parameters;
        if (uint256(parameters.orderType) > 1) {
          OfferItem[] memory offer = parameters.offer;
          uint256 totalOfferItems = offer.length;
          for (uint256 j = 0; j < totalOfferItems; ++j) {
            OfferItem memory offerItem = offer[j];
            assembly {
              mstore(add(offerItem, Common_amount_offset), mload(add(offerItem, Common_endAmount_offset)))
            }
          }
        }
        {
          ConsiderationItem[] memory consideration = (parameters.consideration);
          uint256 totalConsiderationItems = consideration.length;
          for (uint256 j = 0; j < totalConsiderationItems; ++j) {
            ConsiderationItem memory considerationItem = (consideration[j]);
            uint256 unmetAmount = considerationItem.startAmount;
            if (unmetAmount != 0) {
              _revertConsiderationNotMet(i, j, unmetAmount);
            }
            assembly {
              mstore(add(considerationItem, ReceivedItem_amount_offset), mload(add(considerationItem, ConsiderationItem_recipient_offset)))
            }
          }
        }
        _assertRestrictedAdvancedOrderValidity(advancedOrder, orderHashes, orderHashes[i]);
      }
    }
    _clearReentrancyGuard();
    return (availableOrders);
  }

  function _matchAdvancedOrders(AdvancedOrder[] memory advancedOrders, CriteriaResolver[] memory criteriaResolvers, Fulfillment[] calldata fulfillments) internal returns (Execution[] memory executions) {
    bytes32[] memory orderHashes = _validateOrdersAndPrepareToFulfill(advancedOrders, criteriaResolvers, true, advancedOrders.length, address(0));
    return _fulfillAdvancedOrders(advancedOrders, fulfillments, orderHashes);
  }

  function _fulfillAdvancedOrders(AdvancedOrder[] memory advancedOrders, Fulfillment[] calldata fulfillments, bytes32[] memory orderHashes) internal returns (Execution[] memory executions) {
    uint256 totalFulfillments = fulfillments.length;
    executions = new Execution[](totalFulfillments);
    unchecked {
      uint256 totalFilteredExecutions = 0;
      for (uint256 i = 0; i < totalFulfillments; ++i) {
        Fulfillment calldata fulfillment = fulfillments[i];
        Execution memory execution = _applyFulfillment(advancedOrders, fulfillment.offerComponents, fulfillment.considerationComponents);
        if (_unmaskedAddressComparison(execution.item.recipient, execution.offerer)) {
          ++totalFilteredExecutions;
        } else {
          executions[i - totalFilteredExecutions] = execution;
        }
      }
      if (totalFilteredExecutions != 0) {
        assembly {
          mstore(executions, sub(mload(executions), totalFilteredExecutions))
        }
      }
    }
    _performFinalChecksAndExecuteOrders(advancedOrders, executions, orderHashes);
    return (executions);
  }
}