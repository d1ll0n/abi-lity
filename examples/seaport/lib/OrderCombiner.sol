pragma solidity ^0.8.13;

import { Side, ItemType } from "./ConsiderationEnums.sol";
import { OfferItem, ConsiderationItem, ReceivedItem, OrderParameters, Fulfillment, FulfillmentComponent, Execution, Order, AdvancedOrder, CriteriaResolver } from "./ConsiderationStructs.sol";
import { OrderFulfiller } from "./OrderFulfiller.sol";
import { FulfillmentApplier } from "./FulfillmentApplier.sol";
import "./ConsiderationErrors.sol";

///  @title OrderCombiner
///  @author 0age
///  @notice OrderCombiner contains logic for fulfilling combinations of orders,
///          either by matching offer items to consideration items or by
///          fulfilling orders where available.
contract OrderCombiner is OrderFulfiller, FulfillmentApplier {
  ///  @dev Derive and set hashes, reference chainId, and associated domain
  ///       separator during deployment.
  ///  @param conduitController A contract that deploys conduits, or proxies
  ///                           that may optionally be used to transfer approved
  ///                           ERC20/721/1155 tokens.
  constructor(address conduitController) OrderFulfiller(conduitController) {}

  ///  @notice Internal function to attempt to fill a group of orders, fully or
  ///          partially, with an arbitrary number of items for offer and
  ///          consideration per order alongside criteria resolvers containing
  ///          specific token identifiers and associated proofs. Any order that
  ///          is not currently active, has already been fully filled, or has
  ///          been cancelled will be omitted. Remaining offer and consideration
  ///          items will then be aggregated where possible as indicated by the
  ///          supplied offer and consideration component arrays and aggregated
  ///          items will be transferred to the fulfiller or to each intended
  ///          recipient, respectively. Note that a failing item transfer or an
  ///          issue with order formatting will cause the entire batch to fail.
  ///  @param advancedOrders            The orders to fulfill along with the
  ///                                   fraction of those orders to attempt to
  ///                                   fill. Note that both the offerer and the
  ///                                   fulfiller must first approve this
  ///                                   contract (or a conduit if indicated by
  ///                                   the order) to transfer any relevant
  ///                                   tokens on their behalf and that
  ///                                   contracts must implement
  ///                                   `onERC1155Received` in order to receive
  ///                                   ERC1155 tokens as consideration. Also
  ///                                   note that all offer and consideration
  ///                                   components must have no remainder after
  ///                                   multiplication of the respective amount
  ///                                   with the supplied fraction for an
  ///                                   order's partial fill amount to be
  ///                                   considered valid.
  ///  @param criteriaResolvers         An array where each element contains a
  ///                                   reference to a specific offer or
  ///                                   consideration, a token identifier, and a
  ///                                   proof that the supplied token identifier
  ///                                   is contained in the merkle root held by
  ///                                   the item in question's criteria element.
  ///                                   Note that an empty criteria indicates
  ///                                   that any (transferable) token
  ///                                   identifier on the token in question is
  ///                                   valid and that no associated proof needs
  ///                                   to be supplied.
  ///  @param offerFulfillments         An array of FulfillmentComponent arrays
  ///                                   indicating which offer items to attempt
  ///                                   to aggregate when preparing executions.
  ///  @param considerationFulfillments An array of FulfillmentComponent arrays
  ///                                   indicating which consideration items to
  ///                                   attempt to aggregate when preparing
  ///                                   executions.
  ///  @param fulfillerConduitKey       A bytes32 value indicating what conduit,
  ///                                   if any, to source the fulfiller's token
  ///                                   approvals from. The zero hash signifies
  ///                                   that no conduit should be used (and
  ///                                   direct approvals set on Consideration).
  ///  @param recipient                 The intended recipient for all received
  ///                                   items.
  ///  @param maximumFulfilled          The maximum number of orders to fulfill.
  ///  @return availableOrders An array of booleans indicating if each order
  ///                          with an index corresponding to the index of the
  ///                          returned boolean was fulfillable or not.
  ///  @return executions      An array of elements indicating the sequence of
  ///                          transfers performed as part of matching the given
  ///                          orders.
  function _fulfillAvailableAdvancedOrders(AdvancedOrder[] memory advancedOrders, CriteriaResolver[] memory criteriaResolvers, FulfillmentComponent[][] calldata offerFulfillments, FulfillmentComponent[][] calldata considerationFulfillments, bytes32 fulfillerConduitKey, address recipient, uint256 maximumFulfilled) internal returns (bool[] memory availableOrders, Execution[] memory executions) {
    bytes32[] memory orderHashes = _validateOrdersAndPrepareToFulfill(advancedOrders, criteriaResolvers, false, maximumFulfilled, recipient);
    (availableOrders, executions) = _executeAvailableFulfillments(advancedOrders, offerFulfillments, considerationFulfillments, fulfillerConduitKey, recipient, orderHashes);
    return (availableOrders, executions);
  }

  ///  @dev Internal function to validate a group of orders, update their
  ///       statuses, reduce amounts by their previously filled fractions, apply
  ///       criteria resolvers, and emit OrderFulfilled events.
  ///  @param advancedOrders    The advanced orders to validate and reduce by
  ///                           their previously filled amounts.
  ///  @param criteriaResolvers An array where each element contains a reference
  ///                           to a specific order as well as that order's
  ///                           offer or consideration, a token identifier, and
  ///                           a proof that the supplied token identifier is
  ///                           contained in the order's merkle root. Note that
  ///                           a root of zero indicates that any transferable
  ///                           token identifier is valid and that no proof
  ///                           needs to be supplied.
  ///  @param revertOnInvalid   A boolean indicating whether to revert on any
  ///                           order being invalid; setting this to false will
  ///                           instead cause the invalid order to be skipped.
  ///  @param maximumFulfilled  The maximum number of orders to fulfill.
  ///  @param recipient         The intended recipient for all received items.
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

  ///  @dev Internal function to fulfill a group of validated orders, fully or
  ///       partially, with an arbitrary number of items for offer and
  ///       consideration per order and to execute transfers. Any order that is
  ///       not currently active, has already been fully filled, or has been
  ///       cancelled will be omitted. Remaining offer and consideration items
  ///       will then be aggregated where possible as indicated by the supplied
  ///       offer and consideration component arrays and aggregated items will
  ///       be transferred to the fulfiller or to each intended recipient,
  ///       respectively. Note that a failing item transfer or an issue with
  ///       order formatting will cause the entire batch to fail.
  ///  @param advancedOrders            The orders to fulfill along with the
  ///                                   fraction of those orders to attempt to
  ///                                   fill. Note that both the offerer and the
  ///                                   fulfiller must first approve this
  ///                                   contract (or the conduit if indicated by
  ///                                   the order) to transfer any relevant
  ///                                   tokens on their behalf and that
  ///                                   contracts must implement
  ///                                   `onERC1155Received` in order to receive
  ///                                   ERC1155 tokens as consideration. Also
  ///                                   note that all offer and consideration
  ///                                   components must have no remainder after
  ///                                   multiplication of the respective amount
  ///                                   with the supplied fraction for an
  ///                                   order's partial fill amount to be
  ///                                   considered valid.
  ///  @param offerFulfillments         An array of FulfillmentComponent arrays
  ///                                   indicating which offer items to attempt
  ///                                   to aggregate when preparing executions.
  ///  @param considerationFulfillments An array of FulfillmentComponent arrays
  ///                                   indicating which consideration items to
  ///                                   attempt to aggregate when preparing
  ///                                   executions.
  ///  @param fulfillerConduitKey       A bytes32 value indicating what conduit,
  ///                                   if any, to source the fulfiller's token
  ///                                   approvals from. The zero hash signifies
  ///                                   that no conduit should be used, with
  ///                                   direct approvals set on Consideration.
  ///  @param recipient                 The intended recipient for all received
  ///                                   items.
  ///  @return availableOrders An array of booleans indicating if each order
  ///                          with an index corresponding to the index of the
  ///                          returned boolean was fulfillable or not.
  ///  @return executions      An array of elements indicating the sequence of
  ///                          transfers performed as part of matching the given
  ///                          orders.
  function _executeAvailableFulfillments(AdvancedOrder[] memory advancedOrders, FulfillmentComponent[][] memory offerFulfillments, FulfillmentComponent[][] memory considerationFulfillments, bytes32 fulfillerConduitKey, address recipient, bytes32[] memory orderHashes) internal returns (bool[] memory availableOrders, Execution[] memory executions) {
    uint256 totalOfferFulfillments = offerFulfillments.length;
    uint256 totalConsiderationFulfillments = (considerationFulfillments.length);
    executions = new Execution[](totalOfferFulfillments + totalConsiderationFulfillments);
    unchecked {
      uint256 totalFilteredExecutions = 0;
      for (uint256 i = 0; i < totalOfferFulfillments; ++i) {
        /// Retrieve the offer fulfillment components in question.
        FulfillmentComponent[] memory components = (offerFulfillments[i]);
        Execution memory execution = _aggregateAvailable(advancedOrders, Side.OFFER, components, fulfillerConduitKey, recipient);
        if (_unmaskedAddressComparison(execution.item.recipient, execution.offerer)) {
          ++totalFilteredExecutions;
        } else {
          executions[i - totalFilteredExecutions] = execution;
        }
      }
      for (uint256 i = 0; i < totalConsiderationFulfillments; ++i) {
        /// Retrieve consideration fulfillment components in question.
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

  ///  @dev Internal function to perform a final check that each consideration
  ///       item for an arbitrary number of fulfilled orders has been met and to
  ///       trigger associated executions, transferring the respective items.
  ///  @param advancedOrders     The orders to check and perform executions for.
  ///  @param executions         An array of elements indicating the sequence of
  ///                            transfers to perform when fulfilling the given
  ///                            orders.
  ///  @return availableOrders An array of booleans indicating if each order
  ///                          with an index corresponding to the index of the
  ///                          returned boolean was fulfillable or not.
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

  ///  @dev Internal function to match an arbitrary number of full or partial
  ///       orders, each with an arbitrary number of items for offer and
  ///       consideration, supplying criteria resolvers containing specific
  ///       token identifiers and associated proofs as well as fulfillments
  ///       allocating offer components to consideration components.
  ///  @param advancedOrders    The advanced orders to match. Note that both the
  ///                           offerer and fulfiller on each order must first
  ///                           approve this contract (or their conduit if
  ///                           indicated by the order) to transfer any relevant
  ///                           tokens on their behalf and each consideration
  ///                           recipient must implement `onERC1155Received` in
  ///                           order to receive ERC1155 tokens. Also note that
  ///                           the offer and consideration components for each
  ///                           order must have no remainder after multiplying
  ///                           the respective amount with the supplied fraction
  ///                           in order for the group of partial fills to be
  ///                           considered valid.
  ///  @param criteriaResolvers An array where each element contains a reference
  ///                           to a specific order as well as that order's
  ///                           offer or consideration, a token identifier, and
  ///                           a proof that the supplied token identifier is
  ///                           contained in the order's merkle root. Note that
  ///                           an empty root indicates that any (transferable)
  ///                           token identifier is valid and that no associated
  ///                           proof needs to be supplied.
  ///  @param fulfillments      An array of elements allocating offer components
  ///                           to consideration components. Note that each
  ///                           consideration component must be fully met in
  ///                           order for the match operation to be valid.
  ///  @return executions An array of elements indicating the sequence of
  ///                     transfers performed as part of matching the given
  ///                     orders.
  function _matchAdvancedOrders(AdvancedOrder[] memory advancedOrders, CriteriaResolver[] memory criteriaResolvers, Fulfillment[] calldata fulfillments) internal returns (Execution[] memory executions) {
    bytes32[] memory orderHashes = _validateOrdersAndPrepareToFulfill(advancedOrders, criteriaResolvers, true, advancedOrders.length, address(0));
    return _fulfillAdvancedOrders(advancedOrders, fulfillments, orderHashes);
  }

  ///  @dev Internal function to fulfill an arbitrary number of orders, either
  ///       full or partial, after validating, adjusting amounts, and applying
  ///       criteria resolvers.
  ///  @param advancedOrders     The orders to match, including a fraction to
  ///                            attempt to fill for each order.
  ///  @param fulfillments       An array of elements allocating offer
  ///                            components to consideration components. Note
  ///                            that the final amount of each consideration
  ///                            component must be zero for a match operation to
  ///                            be considered valid.
  ///  @return executions An array of elements indicating the sequence of
  ///                     transfers performed as part of matching the given
  ///                     orders.
  function _fulfillAdvancedOrders(AdvancedOrder[] memory advancedOrders, Fulfillment[] calldata fulfillments, bytes32[] memory orderHashes) internal returns (Execution[] memory executions) {
    uint256 totalFulfillments = fulfillments.length;
    executions = new Execution[](totalFulfillments);
    unchecked {
      uint256 totalFilteredExecutions = 0;
      for (uint256 i = 0; i < totalFulfillments; ++i) {
        /// Retrieve the fulfillment in question.
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