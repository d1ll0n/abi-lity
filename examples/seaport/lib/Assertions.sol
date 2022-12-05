pragma solidity ^0.8.13;

import { OrderParameters } from "./ConsiderationStructs.sol";
import { GettersAndDerivers } from "./GettersAndDerivers.sol";
import { TokenTransferrerErrors } from "../interfaces/TokenTransferrerErrors.sol";
import { CounterManager } from "./CounterManager.sol";
import "./ConsiderationErrors.sol";

/// @title Assertions
///   @author 0age
///   @notice Assertions contains logic for making various assertions that do not
///           fit neatly within a dedicated semantic scope.
contract Assertions is GettersAndDerivers, CounterManager, TokenTransferrerErrors {
  /// @dev Derive and set hashes, reference chainId, and associated domain
  ///        separator during deployment.
  ///   @param conduitController A contract that deploys conduits, or proxies
  ///                            that may optionally be used to transfer approved
  ///                            ERC20/721/1155 tokens.
  constructor(address conduitController) GettersAndDerivers(conduitController) {}

  /// @dev Internal view function to ensure that the supplied consideration
  ///        array length on a given set of order parameters is not less than the
  ///        original consideration array length for that order and to retrieve
  ///        the current counter for a given order's offerer and zone and use it
  ///        to derive the order hash.
  ///   @param orderParameters The parameters of the order to hash.
  ///   @return The hash.
  function _assertConsiderationLengthAndGetOrderHash(OrderParameters memory orderParameters) internal view returns (bytes32) {
    _assertConsiderationLengthIsNotLessThanOriginalConsiderationLength(orderParameters.consideration.length, orderParameters.totalOriginalConsiderationItems);
    return _deriveOrderHash(orderParameters, _getCounter(orderParameters.offerer));
  }

  /// @dev Internal pure function to ensure that the supplied consideration
  ///        array length for an order to be fulfilled is not less than the
  ///        original consideration array length for that order.
  ///   @param suppliedConsiderationItemTotal The number of consideration items
  ///                                         supplied when fulfilling the order.
  ///   @param originalConsiderationItemTotal The number of consideration items
  ///                                         supplied on initial order creation.
  function _assertConsiderationLengthIsNotLessThanOriginalConsiderationLength(uint256 suppliedConsiderationItemTotal, uint256 originalConsiderationItemTotal) internal pure {
    if (suppliedConsiderationItemTotal < originalConsiderationItemTotal) {
      _revertMissingOriginalConsiderationItems();
    }
  }

  /// @dev Internal pure function to ensure that a given item amount is not
  ///        zero.
  ///   @param amount The amount to check.
  function _assertNonZeroAmount(uint256 amount) internal pure {
    assembly {
      if iszero(amount) {
        mstore(0, MissingItemAmount_error_selector)
        revert(0x1c, MissingItemAmount_error_length)
      }
    }
  }

  /// @dev Internal pure function to validate calldata offsets for dynamic
  ///        types in BasicOrderParameters and other parameters. This ensures
  ///        that functions using the calldata object normally will be using the
  ///        same data as the assembly functions and that values that are bound
  ///        to a given range are within that range. Note that no parameters are
  ///        supplied as all basic order functions use the same calldata
  ///        encoding.
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