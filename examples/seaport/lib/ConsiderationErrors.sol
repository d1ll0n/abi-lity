pragma solidity >=0.8.13;
import "./ConsiderationConstants.sol";
function _revertBadFraction() pure {
  assembly {
    mstore(0, BadFraction_error_selector)
    revert(0x1c, BadFraction_error_length)
  }
}
function _revertConsiderationCriteriaResolverOutOfRange() pure {
  assembly {
    mstore(0, ConsiderationCriteriaResolverOutOfRange_error_selector)
    revert(0x1c, ConsiderationCriteriaResolverOutOfRange_error_length)
  }
}
function _revertConsiderationNotMet(uint256 orderIndex, uint256 considerationIndex, uint256 shortfallAmount) pure {
  assembly {
    mstore(0, ConsiderationNotMet_error_selector)
    mstore(ConsiderationNotMet_error_orderIndex_ptr, orderIndex)
    mstore(ConsiderationNotMet_error_considerationIndex_ptr, considerationIndex)
    mstore(ConsiderationNotMet_error_shortfallAmount_ptr, shortfallAmount)
    revert(0x1c, ConsiderationNotMet_error_length)
  }
}
function _revertCriteriaNotEnabledForItem() pure {
  assembly {
    mstore(0, CriteriaNotEnabledForItem_error_selector)
    revert(0x1c, CriteriaNotEnabledForItem_error_length)
  }
}
function _revertInsufficientEtherSupplied() pure {
  assembly {
    mstore(0, InsufficientEtherSupplied_error_selector)
    revert(0x1c, InsufficientEtherSupplied_error_length)
  }
}
function _revertInvalidBasicOrderParameterEncoding() pure {
  assembly {
    mstore(0, InvalidBasicOrderParameterEncoding_error_selector)
    revert(0x1c, InvalidBasicOrderParameterEncoding_error_length)
  }
}
function _revertInvalidCallToConduit(address conduit) pure {
  assembly {
    mstore(0, InvalidCallToConduit_error_selector)
    mstore(InvalidCallToConduit_error_conduit_ptr, conduit)
    revert(0x1c, InvalidCallToConduit_error_length)
  }
}
function _revertInvalidCanceller() pure {
  assembly {
    mstore(0, InvalidCanceller_error_selector)
    revert(0x1c, InvalidCanceller_error_length)
  }
}
function _revertInvalidConduit(bytes32 conduitKey, address conduit) pure {
  assembly {
    mstore(0, InvalidConduit_error_selector)
    mstore(InvalidConduit_error_conduitKey_ptr, conduitKey)
    mstore(InvalidConduit_error_conduit_ptr, conduit)
    revert(0x1c, InvalidConduit_error_length)
  }
}
function _revertInvalidERC721TransferAmount() pure {
  assembly {
    mstore(0, InvalidERC721TransferAmount_error_selector)
    revert(0x1c, InvalidERC721TransferAmount_error_length)
  }
}
function _revertInvalidMsgValue(uint256 value) pure {
  assembly {
    mstore(0, InvalidMsgValue_error_selector)
    mstore(InvalidMsgValue_error_value_ptr, value)
    revert(0x1c, InvalidMsgValue_error_length)
  }
}
function _revertInvalidNativeOfferItem() pure {
  assembly {
    mstore(0, InvalidNativeOfferItem_error_selector)
    revert(0x1c, InvalidNativeOfferItem_error_length)
  }
}
function _revertInvalidProof() pure {
  assembly {
    mstore(0, InvalidProof_error_selector)
    revert(0x1c, InvalidProof_error_length)
  }
}
function _revertInvalidRestrictedOrder(bytes32 orderHash) pure {
  assembly {
    mstore(0, InvalidRestrictedOrder_error_selector)
    mstore(InvalidRestrictedOrder_error_orderHash_ptr, orderHash)
    revert(0x1c, InvalidRestrictedOrder_error_length)
  }
}
function _revertInvalidContractOrder(bytes32 orderHash) pure {
  assembly {
    mstore(0, InvalidContractOrder_error_selector)
    mstore(InvalidContractOrder_error_orderHash_ptr, orderHash)
    revert(0x1c, InvalidContractOrder_error_length)
  }
}
function _revertInvalidTime() pure {
  assembly {
    mstore(0, InvalidTime_error_selector)
    revert(0x1c, InvalidTime_error_length)
  }
}
function _revertMismatchedFulfillmentOfferAndConsiderationComponents() pure {
  assembly {
    mstore(0, MismatchedFulfillmentOfferAndConsiderationComponents_error_selector)
    revert(0x1c, MismatchedFulfillmentOfferAndConsiderationComponents_error_length)
  }
}
function _revertMissingFulfillmentComponentOnAggregation(uint8 side) pure {
  assembly {
    mstore(0, MissingFulfillmentComponentOnAggregation_error_selector)
    mstore(MissingFulfillmentComponentOnAggregation_error_side_ptr, side)
    revert(0x1c, MissingFulfillmentComponentOnAggregation_error_length)
  }
}
function _revertMissingOriginalConsiderationItems() pure {
  assembly {
    mstore(0, MissingOriginalConsiderationItems_error_selector)
    revert(0x1c, MissingOriginalConsiderationItems_error_length)
  }
}
function _revertNoReentrantCalls() pure {
  assembly {
    mstore(0, NoReentrantCalls_error_selector)
    revert(0x1c, NoReentrantCalls_error_length)
  }
}
function _revertNoSpecifiedOrdersAvailable() pure {
  assembly {
    mstore(0, NoSpecifiedOrdersAvailable_error_selector)
    revert(0x1c, NoSpecifiedOrdersAvailable_error_length)
  }
}
function _revertOfferAndConsiderationRequiredOnFulfillment() pure {
  assembly {
    mstore(0, OfferAndConsiderationRequiredOnFulfillment_error_selector)
    revert(0x1c, OfferAndConsiderationRequiredOnFulfillment_error_length)
  }
}
function _revertOfferCriteriaResolverOutOfRange() pure {
  assembly {
    mstore(0, OfferCriteriaResolverOutOfRange_error_selector)
    revert(0x1c, OfferCriteriaResolverOutOfRange_error_length)
  }
}
function _revertOrderAlreadyFilled(bytes32 orderHash) pure {
  assembly {
    mstore(0, OrderAlreadyFilled_error_selector)
    mstore(OrderAlreadyFilled_error_orderHash_ptr, orderHash)
    revert(0x1c, OrderAlreadyFilled_error_length)
  }
}
function _revertOrderCriteriaResolverOutOfRange() pure {
  assembly {
    mstore(0, OrderCriteriaResolverOutOfRange_error_selector)
    revert(0x1c, OrderCriteriaResolverOutOfRange_error_length)
  }
}
function _revertOrderIsCancelled(bytes32 orderHash) pure {
  assembly {
    mstore(0, OrderIsCancelled_error_selector)
    mstore(OrderIsCancelled_error_orderHash_ptr, orderHash)
    revert(0x1c, OrderIsCancelled_error_length)
  }
}
function _revertOrderPartiallyFilled(bytes32 orderHash) pure {
  assembly {
    mstore(0, OrderPartiallyFilled_error_selector)
    mstore(OrderPartiallyFilled_error_orderHash_ptr, orderHash)
    revert(0x1c, OrderPartiallyFilled_error_length)
  }
}
function _revertPartialFillsNotEnabledForOrder() pure {
  assembly {
    mstore(0, PartialFillsNotEnabledForOrder_error_selector)
    revert(0x1c, PartialFillsNotEnabledForOrder_error_length)
  }
}
function _revertUnresolvedConsiderationCriteria() pure {
  assembly {
    mstore(0, UnresolvedConsiderationCriteria_error_selector)
    revert(0x1c, UnresolvedConsiderationCriteria_error_length)
  }
}
function _revertUnresolvedOfferCriteria() pure {
  assembly {
    mstore(0, UnresolvedOfferCriteria_error_selector)
    revert(0x1c, UnresolvedOfferCriteria_error_length)
  }
}
function _revertUnusedItemParameters() pure {
  assembly {
    mstore(0, UnusedItemParameters_error_selector)
    revert(0x1c, UnusedItemParameters_error_length)
  }
}