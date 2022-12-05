pragma solidity ^0.8.13;
import { ItemType, Side } from "./ConsiderationEnums.sol";
import { OfferItem, ConsiderationItem, ReceivedItem, OrderParameters, AdvancedOrder, Execution, FulfillmentComponent } from "./ConsiderationStructs.sol";
import "./ConsiderationErrors.sol";
import { FulfillmentApplicationErrors } from "../interfaces/FulfillmentApplicationErrors.sol";

contract FulfillmentApplier is FulfillmentApplicationErrors {

  function _applyFulfillment(AdvancedOrder[] memory advancedOrders, FulfillmentComponent[] calldata offerComponents, FulfillmentComponent[] calldata considerationComponents) internal pure returns (Execution memory execution) {
    if ((offerComponents.length == 0) || (considerationComponents.length == 0)) {
      _revertOfferAndConsiderationRequiredOnFulfillment();
    }
    Execution memory considerationExecution;
    _aggregateValidFulfillmentConsiderationItems(advancedOrders, considerationComponents, considerationExecution);
    ReceivedItem memory considerationItem = considerationExecution.item;
    _aggregateValidFulfillmentOfferItems(advancedOrders, offerComponents, execution);
    if (((execution.item.itemType != considerationItem.itemType) || (execution.item.token != considerationItem.token)) || (execution.item.identifier != considerationItem.identifier)) {
      _revertMismatchedFulfillmentOfferAndConsiderationComponents();
    }
    if (considerationItem.amount > execution.item.amount) {
      FulfillmentComponent memory targetComponent = (considerationComponents[0]);
      unchecked {
        advancedOrders[targetComponent.orderIndex].parameters.consideration[targetComponent.itemIndex].startAmount = (considerationItem.amount - execution.item.amount);
      }
      considerationItem.amount = execution.item.amount;
    } else {
      FulfillmentComponent memory targetComponent = offerComponents[0];
      unchecked {
        advancedOrders[targetComponent.orderIndex].parameters.offer[targetComponent.itemIndex].startAmount = (execution.item.amount - considerationItem.amount);
      }
      execution.item.amount = considerationItem.amount;
    }
    execution.item.recipient = considerationItem.recipient;
    return execution;
  }

  function _aggregateAvailable(AdvancedOrder[] memory advancedOrders, Side side, FulfillmentComponent[] memory fulfillmentComponents, bytes32 fulfillerConduitKey, address recipient) internal view returns (Execution memory execution) {
    unchecked {
      if (fulfillmentComponents.length == 0) {
        _revertMissingFulfillmentComponentOnAggregation(uint8(side));
      }
      if (side == Side.OFFER) {
        execution.item.recipient = payable(recipient);
        _aggregateValidFulfillmentOfferItems(advancedOrders, fulfillmentComponents, execution);
      } else {
        _aggregateValidFulfillmentConsiderationItems(advancedOrders, fulfillmentComponents, execution);
        execution.offerer = msg.sender;
        execution.conduitKey = fulfillerConduitKey;
      }
      if (execution.item.amount == 0) {
        execution.offerer = address(0);
        execution.item.recipient = payable(0);
      }
    }
  }

  function _aggregateValidFulfillmentOfferItems(AdvancedOrder[] memory advancedOrders, FulfillmentComponent[] memory offerComponents, Execution memory execution) internal pure {
    assembly {
      function throwInvalidFulfillmentComponentData () {
        mstore(0, InvalidFulfillmentComponentData_error_selector)
        revert(0x1c, InvalidFulfillmentComponentData_error_length)
      }
      function throwOverflow () {
        mstore(0, Panic_error_selector)
        mstore(Panic_error_code_ptr, Panic_arithmetic)
        revert(0x1c, Panic_error_length)
      }
      let fulfillmentHeadPtr := add(offerComponents, OneWord)
      let orderIndex := mload(mload(fulfillmentHeadPtr))
      if iszero(lt(orderIndex, mload(advancedOrders))) {
        throwInvalidFulfillmentComponentData()
      }
      let orderPtr := mload(add(add(advancedOrders, OneWord), mul(orderIndex, OneWord)))
      let paramsPtr := mload(orderPtr)
      let offerArrPtr := mload(add(paramsPtr, OrderParameters_offer_head_offset))
      let itemIndex := mload(add(mload(fulfillmentHeadPtr), Fulfillment_itemIndex_offset))
      if iszero(lt(itemIndex, mload(offerArrPtr))) {
        throwInvalidFulfillmentComponentData()
      }
      let offerItemPtr := mload(add(add(offerArrPtr, OneWord), mul(itemIndex, OneWord)))
      let amount := 0
      let errorBuffer := 0
      if mload(add(orderPtr, AdvancedOrder_numerator_offset)) {
        let amountPtr := add(offerItemPtr, Common_amount_offset)
        amount := mload(amountPtr)
        mstore(amountPtr, 0)
        errorBuffer := iszero(amount)
      }
      let receivedItemPtr := mload(execution)
      mstore(receivedItemPtr, mload(offerItemPtr))
      mstore(add(receivedItemPtr, Common_token_offset), mload(add(offerItemPtr, Common_token_offset)))
      mstore(add(receivedItemPtr, Common_identifier_offset), mload(add(offerItemPtr, Common_identifier_offset)))
      mstore(add(execution, Execution_offerer_offset), mload(paramsPtr))
      mstore(add(execution, Execution_conduit_offset), mload(add(paramsPtr, OrderParameters_conduit_offset)))
      let dataHash := keccak256(receivedItemPtr, ReceivedItem_CommonParams_size)
      let endPtr := add(offerComponents, mul(mload(offerComponents), OneWord))
      for {} lt(fulfillmentHeadPtr, endPtr) {} {
        fulfillmentHeadPtr := add(fulfillmentHeadPtr, OneWord)
        orderIndex := mload(mload(fulfillmentHeadPtr))
        if iszero(lt(orderIndex, mload(advancedOrders))) {
          throwInvalidFulfillmentComponentData()
        }
        orderPtr := mload(add(add(advancedOrders, OneWord), mul(orderIndex, OneWord)))
        if iszero(mload(add(orderPtr, AdvancedOrder_numerator_offset))) {
          continue
        }
        paramsPtr := mload(orderPtr)
        offerArrPtr := mload(add(paramsPtr, OrderParameters_offer_head_offset))
        itemIndex := mload(add(mload(fulfillmentHeadPtr), OneWord))
        if iszero(lt(itemIndex, mload(offerArrPtr))) {
          throwInvalidFulfillmentComponentData()
        }
        offerItemPtr := mload(add(add(offerArrPtr, OneWord), mul(itemIndex, OneWord)))
        let amountPtr := add(offerItemPtr, Common_amount_offset)
        let newAmount := add(amount, mload(amountPtr))
        errorBuffer := or(errorBuffer, or(shl(1, lt(newAmount, amount)), iszero(mload(amountPtr))))
        amount := newAmount
        mstore(amountPtr, 0)
        if iszero(and(and(eq(mload(paramsPtr), mload(add(execution, Execution_offerer_offset))), eq(mload(add(paramsPtr, OrderParameters_conduit_offset)), mload(add(execution, Execution_conduit_offset)))), eq(dataHash, keccak256(offerItemPtr, ReceivedItem_CommonParams_size)))) {
          throwInvalidFulfillmentComponentData()
        }
      }
      mstore(add(mload(execution), Common_amount_offset), amount)
      if errorBuffer {
        if eq(errorBuffer, 1) {
          mstore(0, MissingItemAmount_error_selector)
          revert(0x1c, MissingItemAmount_error_length)
        }
        throwOverflow()
      }
    }
  }

  function _aggregateValidFulfillmentConsiderationItems(AdvancedOrder[] memory advancedOrders, FulfillmentComponent[] memory considerationComponents, Execution memory execution) internal pure {
    assembly {
      function throwInvalidFulfillmentComponentData () {
        mstore(0, InvalidFulfillmentComponentData_error_selector)
        revert(0x1c, InvalidFulfillmentComponentData_error_length)
      }
      function throwOverflow () {
        mstore(0, Panic_error_selector)
        mstore(Panic_error_code_ptr, Panic_arithmetic)
        revert(0x1c, Panic_error_length)
      }
      let fulfillmentHeadPtr := add(considerationComponents, OneWord)
      let orderIndex := mload(mload(fulfillmentHeadPtr))
      if iszero(lt(orderIndex, mload(advancedOrders))) {
        throwInvalidFulfillmentComponentData()
      }
      let orderPtr := mload(add(add(advancedOrders, OneWord), mul(orderIndex, OneWord)))
      let considerationArrPtr := mload(add(mload(orderPtr), OrderParameters_consideration_head_offset))
      let itemIndex := mload(add(mload(fulfillmentHeadPtr), Fulfillment_itemIndex_offset))
      if iszero(lt(itemIndex, mload(considerationArrPtr))) {
        throwInvalidFulfillmentComponentData()
      }
      let considerationItemPtr := mload(add(add(considerationArrPtr, OneWord), mul(itemIndex, OneWord)))
      let amount := 0
      let errorBuffer := 0
      if mload(add(orderPtr, AdvancedOrder_numerator_offset)) {
        let amountPtr := add(considerationItemPtr, Common_amount_offset)
        amount := mload(amountPtr)
        errorBuffer := iszero(amount)
        mstore(amountPtr, 0)
      }
      let receivedItem := mload(execution)
      mstore(receivedItem, mload(considerationItemPtr))
      mstore(add(receivedItem, Common_token_offset), mload(add(considerationItemPtr, Common_token_offset)))
      mstore(add(receivedItem, Common_identifier_offset), mload(add(considerationItemPtr, Common_identifier_offset)))
      mstore(add(receivedItem, ReceivedItem_recipient_offset), mload(add(considerationItemPtr, ReceivedItem_recipient_offset)))
      let dataHash := keccak256(receivedItem, ReceivedItem_CommonParams_size)
      let endPtr := add(considerationComponents, mul(mload(considerationComponents), OneWord))
      for {} lt(fulfillmentHeadPtr, endPtr) {} {
        fulfillmentHeadPtr := add(fulfillmentHeadPtr, OneWord)
        orderIndex := mload(mload(fulfillmentHeadPtr))
        if iszero(lt(orderIndex, mload(advancedOrders))) {
          throwInvalidFulfillmentComponentData()
        }
        orderPtr := mload(add(add(advancedOrders, OneWord), mul(orderIndex, OneWord)))
        if iszero(mload(add(orderPtr, AdvancedOrder_numerator_offset))) {
          continue
        }
        considerationArrPtr := mload(add(mload(orderPtr), OrderParameters_consideration_head_offset))
        itemIndex := mload(add(mload(fulfillmentHeadPtr), OneWord))
        if iszero(lt(itemIndex, mload(considerationArrPtr))) {
          throwInvalidFulfillmentComponentData()
        }
        considerationItemPtr := mload(add(add(considerationArrPtr, OneWord), mul(itemIndex, OneWord)))
        let amountPtr := add(considerationItemPtr, Common_amount_offset)
        let newAmount := add(amount, mload(amountPtr))
        errorBuffer := or(errorBuffer, or(shl(1, lt(newAmount, amount)), iszero(mload(amountPtr))))
        amount := newAmount
        mstore(amountPtr, 0)
        if iszero(and(eq(mload(add(considerationItemPtr, ReceivedItem_recipient_offset)), mload(add(receivedItem, ReceivedItem_recipient_offset))), eq(dataHash, keccak256(considerationItemPtr, ReceivedItem_CommonParams_size)))) {
          throwInvalidFulfillmentComponentData()
        }
      }
      mstore(add(receivedItem, Common_amount_offset), amount)
      if errorBuffer {
        if eq(errorBuffer, 1) {
          mstore(0, MissingItemAmount_error_selector)
          revert(0x1c, MissingItemAmount_error_length)
        }
        throwOverflow()
      }
    }
  }
}