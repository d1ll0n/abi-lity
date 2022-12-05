pragma solidity ^0.8.13;
import { OrderParameters } from "./ConsiderationStructs.sol";
import { GettersAndDerivers } from "./GettersAndDerivers.sol";
import { TokenTransferrerErrors } from "../interfaces/TokenTransferrerErrors.sol";
import { CounterManager } from "./CounterManager.sol";
import "./ConsiderationErrors.sol";

contract Assertions is GettersAndDerivers, CounterManager, TokenTransferrerErrors {

  constructor(address conduitController) GettersAndDerivers(conduitController) {}

  function _assertConsiderationLengthAndGetOrderHash(OrderParameters memory orderParameters) internal view returns (bytes32) {
    _assertConsiderationLengthIsNotLessThanOriginalConsiderationLength(orderParameters.consideration.length, orderParameters.totalOriginalConsiderationItems);
    return _deriveOrderHash(orderParameters, _getCounter(orderParameters.offerer));
  }

  function _assertConsiderationLengthIsNotLessThanOriginalConsiderationLength(uint256 suppliedConsiderationItemTotal, uint256 originalConsiderationItemTotal) internal pure {
    if (suppliedConsiderationItemTotal < originalConsiderationItemTotal) {
      _revertMissingOriginalConsiderationItems();
    }
  }

  function _assertNonZeroAmount(uint256 amount) internal pure {
    assembly {
      if iszero(amount) {
        mstore(0, MissingItemAmount_error_selector)
        revert(0x1c, MissingItemAmount_error_length)
      }
    }
  }

  function _assertValidBasicOrderParameters() internal pure {
    bool validOffsets;
    assembly {
      validOffsets := and(eq(calldataload(BasicOrder_parameters_cdPtr), BasicOrder_parameters_ptr), eq(calldataload(BasicOrder_additionalRecipients_head_cdPtr), BasicOrder_additionalRecipients_head_ptr))
      validOffsets := and(validOffsets, eq(calldataload(BasicOrder_signature_cdPtr), add(BasicOrder_signature_ptr, mul(calldataload(BasicOrder_additionalRecipients_length_cdPtr), AdditionalRecipients_size))))
      validOffsets := and(validOffsets, lt(calldataload(BasicOrder_basicOrderType_cdPtr), BasicOrder_basicOrderType_range))
    }
    if (!validOffsets) {
      _revertInvalidBasicOrderParameterEncoding();
    }
  }
}