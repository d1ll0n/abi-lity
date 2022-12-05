pragma solidity ^0.8.13;

import { AmountDerivationErrors } from "../interfaces/AmountDerivationErrors.sol";
import "./ConsiderationConstants.sol";

/// @title AmountDeriver
///   @author 0age
///   @notice AmountDeriver contains view and pure functions related to deriving
///           item amounts based on partial fill quantity and on linear
///           interpolation based on current time when the start amount and end
///           amount differ.
contract AmountDeriver is AmountDerivationErrors {
  /// @dev Internal view function to derive the current amount of a given item
  ///        based on the current price, the starting price, and the ending
  ///        price. If the start and end prices differ, the current price will be
  ///        interpolated on a linear basis. Note that this function expects that
  ///        the startTime parameter of orderParameters is not greater than the
  ///        current block timestamp and that the endTime parameter is greater
  ///        than the current block timestamp. If this condition is not upheld,
  ///        duration / elapsed / remaining variables will underflow.
  ///   @param startAmount The starting amount of the item.
  ///   @param endAmount   The ending amount of the item.
  ///   @param startTime   The starting time of the order.
  ///   @param endTime     The end time of the order.
  ///   @param roundUp     A boolean indicating whether the resultant amount
  ///                      should be rounded up or down.
  ///   @return amount The current amount.
  function _locateCurrentAmount(uint256 startAmount, uint256 endAmount, uint256 startTime, uint256 endTime, bool roundUp) internal view returns (uint256 amount) {
    if (startAmount != endAmount) {
      uint256 duration;
      uint256 elapsed;
      uint256 remaining;
      unchecked {
        duration = endTime - startTime;
        elapsed = block.timestamp - startTime;
        remaining = duration - elapsed;
      }
      uint256 totalBeforeDivision = ((startAmount * remaining) + (endAmount * elapsed));
      assembly {
        amount := mul(iszero(iszero(totalBeforeDivision)), add(div(sub(totalBeforeDivision, roundUp), duration), roundUp))
      }
      return amount;
    }
    return endAmount;
  }

  /// @dev Internal pure function to return a fraction of a given value and to
  ///        ensure the resultant value does not have any fractional component.
  ///        Note that this function assumes that zero will never be supplied as
  ///        the denominator parameter; invalid / undefined behavior will result
  ///        should a denominator of zero be provided.
  ///   @param numerator   A value indicating the portion of the order that
  ///                      should be filled.
  ///   @param denominator A value indicating the total size of the order. Note
  ///                      that this value cannot be equal to zero.
  ///   @param value       The value for which to compute the fraction.
  ///   @return newValue The value after applying the fraction.
  function _getFraction(uint256 numerator, uint256 denominator, uint256 value) internal pure returns (uint256 newValue) {
    if (numerator == denominator) {
      return value;
    }
    assembly {
      if mulmod(value, numerator, denominator) {
        mstore(0, InexactFraction_error_selector)
        revert(0x1c, InexactFraction_error_length)
      }
    }
    uint256 valueTimesNumerator = value * numerator;
    assembly {
      newValue := div(valueTimesNumerator, denominator)
    }
  }

  /// @dev Internal view function to apply a fraction to a consideration
  ///   or offer item.
  ///   @param startAmount     The starting amount of the item.
  ///   @param endAmount       The ending amount of the item.
  ///   @param numerator       A value indicating the portion of the order that
  ///                          should be filled.
  ///   @param denominator     A value indicating the total size of the order.
  ///   @param startTime       The starting time of the order.
  ///   @param endTime         The end time of the order.
  ///   @param roundUp         A boolean indicating whether the resultant
  ///                          amount should be rounded up or down.
  ///   @return amount The received item to transfer with the final amount.
  function _applyFraction(uint256 startAmount, uint256 endAmount, uint256 numerator, uint256 denominator, uint256 startTime, uint256 endTime, bool roundUp) internal view returns (uint256 amount) {
    if (startAmount == endAmount) {
      amount = _getFraction(numerator, denominator, endAmount);
    } else {
      amount = _locateCurrentAmount(_getFraction(numerator, denominator, startAmount), _getFraction(numerator, denominator, endAmount), startTime, endTime, roundUp);
    }
  }
}