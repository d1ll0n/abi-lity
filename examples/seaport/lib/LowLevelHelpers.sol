pragma solidity ^0.8.13;
import "./ConsiderationConstants.sol";

contract LowLevelHelpers {

  function _call(address target, uint256 callDataMemoryPointer, uint256 callDataLength) internal returns (bool success) {
    assembly {
      mstore(0, 0)
      success := call(gas(), target, 0, callDataMemoryPointer, callDataLength, 0, OneWord)
    }
  }

  function _revertWithReasonIfOneIsReturned() internal view {
    assembly {
      if returndatasize() {
        let returnDataWords := div(add(returndatasize(), AlmostOneWord), OneWord)
        let msizeWords := div(mload(FreeMemoryPointerSlot), OneWord)
        let cost := mul(CostPerWord, returnDataWords)
        if gt(returnDataWords, msizeWords) {
          cost := add(cost, add(mul(sub(returnDataWords, msizeWords), CostPerWord), div(sub(mul(returnDataWords, returnDataWords), mul(msizeWords, msizeWords)), MemoryExpansionCoefficient)))
        }
        if lt(add(cost, ExtraGasBuffer), gas()) {
          returndatacopy(0, 0, returndatasize())
          revert(0, returndatasize())
        }
      }
    }
  }

  function _doesNotMatchMagic(bytes4 expected) internal pure returns (bool) {
    bytes4 result;
    assembly {
      result := mload(0)
    }
    return result != expected;
  }

  function _substituteCallerForEmptyRecipient(address recipient) internal view returns (address updatedRecipient) {
    assembly {
      updatedRecipient := add(recipient, mul(iszero(recipient), caller()))
    }
  }

  function _unmaskedAddressComparison(address a, address b) internal pure returns (bool areEqual) {
    assembly {
      areEqual := eq(a, b)
    }
  }
}