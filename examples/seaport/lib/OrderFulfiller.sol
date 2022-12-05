pragma solidity ^0.8.13;
import { ItemType } from "./ConsiderationEnums.sol";
import { OfferItem, ConsiderationItem, SpentItem, ReceivedItem, OrderParameters, Order, AdvancedOrder, CriteriaResolver } from "./ConsiderationStructs.sol";
import { BasicOrderFulfiller } from "./BasicOrderFulfiller.sol";
import { CriteriaResolution } from "./CriteriaResolution.sol";
import { AmountDeriver } from "./AmountDeriver.sol";
import "./ConsiderationErrors.sol";

contract OrderFulfiller is BasicOrderFulfiller, CriteriaResolution, AmountDeriver {

  constructor(address conduitController) BasicOrderFulfiller(conduitController) {}

  function _validateAndFulfillAdvancedOrder(AdvancedOrder memory advancedOrder, CriteriaResolver[] memory criteriaResolvers, bytes32 fulfillerConduitKey, address recipient) internal returns (bool) {
    _setReentrancyGuard();
    bytes32[] memory priorOrderHashes;
    (bytes32 orderHash, uint256 fillNumerator, uint256 fillDenominator) = _validateOrderAndUpdateStatus(advancedOrder, true);
    AdvancedOrder[] memory advancedOrders = new AdvancedOrder[](1);
    advancedOrders[0] = advancedOrder;
    _applyCriteriaResolvers(advancedOrders, criteriaResolvers);
    OrderParameters memory orderParameters = advancedOrders[0].parameters;
    _applyFractionsAndTransferEach(orderParameters, fillNumerator, fillDenominator, fulfillerConduitKey, recipient);
    _assertRestrictedAdvancedOrderValidity(advancedOrders[0], priorOrderHashes, orderHash);
    _emitOrderFulfilledEvent(orderHash, orderParameters.offerer, orderParameters.zone, recipient, orderParameters.offer, orderParameters.consideration);
    _clearReentrancyGuard();
    return true;
  }

  function _applyFractionsAndTransferEach(OrderParameters memory orderParameters, uint256 numerator, uint256 denominator, bytes32 fulfillerConduitKey, address recipient) internal {
    uint256 startTime = orderParameters.startTime;
    uint256 endTime = orderParameters.endTime;
    bytes memory accumulator = new bytes(AccumulatorDisarmed);

    unchecked {
      function(OfferItem memory, address, bytes32, bytes memory) internal _transferOfferItem;
      {
        function(ReceivedItem memory, address, bytes32, bytes memory) internal _transferReceivedItem = _transfer;
        assembly {
          _transferOfferItem := _transferReceivedItem
        }
      }
      uint256 totalOfferItems = orderParameters.offer.length;
      for (uint256 i = 0; i < totalOfferItems; ++i) {
        OfferItem memory offerItem = orderParameters.offer[i];
        if (offerItem.itemType == ItemType.NATIVE) {
          _revertInvalidNativeOfferItem();
        }
        {
          uint256 amount = _applyFraction(offerItem.startAmount, offerItem.endAmount, numerator, denominator, startTime, endTime, false);
          assembly {
            mstore(add(offerItem, ReceivedItem_amount_offset), amount)
            mstore(add(offerItem, ReceivedItem_recipient_offset), recipient)
          }
        }
        _transferOfferItem(offerItem, orderParameters.offerer, orderParameters.conduitKey, accumulator);
      }
    }
    uint256 etherRemaining = msg.value;

    unchecked {
      function(ConsiderationItem memory, address, bytes32, bytes memory) internal _transferConsiderationItem;
      {
        function(ReceivedItem memory, address, bytes32, bytes memory) internal _transferReceivedItem = _transfer;
        assembly {
          _transferConsiderationItem := _transferReceivedItem
        }
      }
      uint256 totalConsiderationItems = orderParameters.consideration.length;
      for (uint256 i = 0; i < totalConsiderationItems; ++i) {
        ConsiderationItem memory considerationItem = (orderParameters.consideration[i]);
        uint256 amount = _applyFraction(considerationItem.startAmount, considerationItem.endAmount, numerator, denominator, startTime, endTime, true);
        assembly {
          mstore(add(considerationItem, ReceivedItem_amount_offset), amount)
          mstore(add(considerationItem, ReceivedItem_recipient_offset), mload(add(considerationItem, ConsiderationItem_recipient_offset)))
        }
        if (considerationItem.itemType == ItemType.NATIVE) {
          if (amount > etherRemaining) {
            _revertInsufficientEtherSupplied();
          }
          etherRemaining -= amount;
        }
        _transferConsiderationItem(considerationItem, msg.sender, fulfillerConduitKey, accumulator);
      }
    }
    _triggerIfArmed(accumulator);
    if (etherRemaining != 0) {
      _transferEth(payable(msg.sender), etherRemaining);
    }
  }

  function _emitOrderFulfilledEvent(bytes32 orderHash, address offerer, address zone, address fulfiller, OfferItem[] memory offer, ConsiderationItem[] memory consideration) internal {
    SpentItem[] memory spentItems;
    assembly {
      spentItems := offer
    }
    ReceivedItem[] memory receivedItems;
    assembly {
      receivedItems := consideration
    }
    emit OrderFulfilled(orderHash, offerer, zone, fulfiller, spentItems, receivedItems);
  }

  function _convertOrderToAdvanced(Order calldata order) internal pure returns (AdvancedOrder memory advancedOrder) {
    advancedOrder = AdvancedOrder(order.parameters, 1, 1, order.signature, "");
  }

  function _convertOrdersToAdvanced(Order[] calldata orders) internal pure returns (AdvancedOrder[] memory advancedOrders) {
    uint256 totalOrders = orders.length;
    advancedOrders = new AdvancedOrder[](totalOrders);
    unchecked {
      for (uint256 i = 0; i < totalOrders; ++i) {
        advancedOrders[i] = _convertOrderToAdvanced(orders[i]);
      }
    }
    return advancedOrders;
  }
}