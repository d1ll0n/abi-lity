pragma solidity ^0.8.13;

import { ItemType } from "./ConsiderationEnums.sol";
import { OfferItem, ConsiderationItem, SpentItem, ReceivedItem, OrderParameters, Order, AdvancedOrder, CriteriaResolver } from "./ConsiderationStructs.sol";
import { BasicOrderFulfiller } from "./BasicOrderFulfiller.sol";
import { CriteriaResolution } from "./CriteriaResolution.sol";
import { AmountDeriver } from "./AmountDeriver.sol";
import "./ConsiderationErrors.sol";

///  @title OrderFulfiller
///  @author 0age
///  @notice OrderFulfiller contains logic related to order fulfillment where a
///          single order is being fulfilled and where basic order fulfillment is
///          not available as an option.
contract OrderFulfiller is BasicOrderFulfiller, CriteriaResolution, AmountDeriver {
  ///  @dev Derive and set hashes, reference chainId, and associated domain
  ///       separator during deployment.
  ///  @param conduitController A contract that deploys conduits, or proxies
  ///                           that may optionally be used to transfer approved
  ///                           ERC20/721/1155 tokens.
  constructor(address conduitController) BasicOrderFulfiller(conduitController) {}

  ///  @dev Internal function to validate an order and update its status, adjust
  ///       prices based on current time, apply criteria resolvers, determine
  ///       what portion to fill, and transfer relevant tokens.
  ///  @param advancedOrder       The order to fulfill as well as the fraction
  ///                             to fill. Note that all offer and consideration
  ///                             components must divide with no remainder for
  ///                             the partial fill to be valid.
  ///  @param criteriaResolvers   An array where each element contains a
  ///                             reference to a specific offer or
  ///                             consideration, a token identifier, and a proof
  ///                             that the supplied token identifier is
  ///                             contained in the order's merkle root. Note
  ///                             that a criteria of zero indicates that any
  ///                             (transferable) token identifier is valid and
  ///                             that no proof needs to be supplied.
  ///  @param fulfillerConduitKey A bytes32 value indicating what conduit, if
  ///                             any, to source the fulfiller's token approvals
  ///                             from. The zero hash signifies that no conduit
  ///                             should be used, with direct approvals set on
  ///                             Consideration.
  ///  @param recipient           The intended recipient for all received items.
  ///  @return A boolean indicating whether the order has been fulfilled.
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

  ///  @dev Internal function to transfer each item contained in a given single
  ///       order fulfillment after applying a respective fraction to the amount
  ///       being transferred.
  ///  @param orderParameters     The parameters for the fulfilled order.
  ///  @param numerator           A value indicating the portion of the order
  ///                             that should be filled.
  ///  @param denominator         A value indicating the total order size.
  ///  @param fulfillerConduitKey A bytes32 value indicating what conduit, if
  ///                             any, to source the fulfiller's token approvals
  ///                             from. The zero hash signifies that no conduit
  ///                             should be used, with direct approvals set on
  ///                             Consideration.
  ///  @param recipient           The intended recipient for all received items.
  function _applyFractionsAndTransferEach(OrderParameters memory orderParameters, uint256 numerator, uint256 denominator, bytes32 fulfillerConduitKey, address recipient) internal {
    uint256 startTime = orderParameters.startTime;
    uint256 endTime = orderParameters.endTime;
    bytes memory accumulator = new bytes(AccumulatorDisarmed);
    ///  Repurpose existing OfferItem memory regions on the offer array for
    ///  the order by overriding the _transfer function pointer to accept a
    ///  modified OfferItem argument in place of the usual ReceivedItem:
    ///    ========= OfferItem ==========   ====== ReceivedItem ======
    ///    ItemType itemType; ------------> ItemType itemType;
    ///    address token; ----------------> address token;
    ///    uint256 identifierOrCriteria; -> uint256 identifier;
    ///    uint256 startAmount; ----------> uint256 amount;
    ///    uint256 endAmount; ------------> address recipient;
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
    ///  Repurpose existing ConsiderationItem memory regions on the
    ///  consideration array for the order by overriding the _transfer
    ///  function pointer to accept a modified ConsiderationItem argument in
    ///  place of the usual ReceivedItem:
    ///    ====== ConsiderationItem =====   ====== ReceivedItem ======
    ///    ItemType itemType; ------------> ItemType itemType;
    ///    address token; ----------------> address token;
    ///    uint256 identifierOrCriteria;--> uint256 identifier;
    ///    uint256 startAmount; ----------> uint256 amount;
    ///    uint256 endAmount;        /----> address recipient;
    ///    address recipient; ------/
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

  ///  @dev Internal function to emit an OrderFulfilled event. OfferItems are
  ///       translated into SpentItems and ConsiderationItems are translated
  ///       into ReceivedItems.
  ///  @param orderHash     The order hash.
  ///  @param offerer       The offerer for the order.
  ///  @param zone          The zone for the order.
  ///  @param fulfiller     The fulfiller of the order, or the null address if
  ///                       the order was fulfilled via order matching.
  ///  @param offer         The offer items for the order.
  ///  @param consideration The consideration items for the order.
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

  ///  @dev Internal pure function to convert an order to an advanced order with
  ///       numerator and denominator of 1 and empty extraData.
  ///  @param order The order to convert.
  ///  @return advancedOrder The new advanced order.
  function _convertOrderToAdvanced(Order calldata order) internal pure returns (AdvancedOrder memory advancedOrder) {
    advancedOrder = AdvancedOrder(order.parameters, 1, 1, order.signature, "");
  }

  ///  @dev Internal pure function to convert an array of orders to an array of
  ///       advanced orders with numerator and denominator of 1.
  ///  @param orders The orders to convert.
  ///  @return advancedOrders The new array of partial orders.
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