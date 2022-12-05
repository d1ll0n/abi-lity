pragma solidity ^0.8.13;
import { AmountDerivationErrors } from "../interfaces/AmountDerivationErrors.sol";
import "./ConsiderationConstants.sol";

contract AmountDeriver is AmountDerivationErrors {

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

  function _applyFraction(uint256 startAmount, uint256 endAmount, uint256 numerator, uint256 denominator, uint256 startTime, uint256 endTime, bool roundUp) internal view returns (uint256 amount) {
    if (startAmount == endAmount) {
      amount = _getFraction(numerator, denominator, endAmount);
    } else {
      amount = _locateCurrentAmount(_getFraction(numerator, denominator, startAmount), _getFraction(numerator, denominator, endAmount), startTime, endTime, roundUp);
    }
  }
}