pragma solidity ^0.8.13;

import { ReentrancyErrors } from "../interfaces/ReentrancyErrors.sol";
import "./ConsiderationErrors.sol";

///  @title ReentrancyGuard
///  @author 0age
///  @notice ReentrancyGuard contains a storage variable and related functionality
///          for protecting against reentrancy.
contract ReentrancyGuard is ReentrancyErrors {
  uint256 private _reentrancyGuard;

  ///  @dev Initialize the reentrancy guard during deployment.
  constructor() {
    _reentrancyGuard = _NOT_ENTERED;
  }

  ///  @dev Internal function to ensure that the sentinel value for the
  ///       reentrancy guard is not currently set and, if not, to set the
  ///       sentinel value for the reentrancy guard.
  function _setReentrancyGuard() internal {
    _assertNonReentrant();
    _reentrancyGuard = _ENTERED;
  }

  ///  @dev Internal function to unset the reentrancy guard sentinel value.
  function _clearReentrancyGuard() internal {
    _reentrancyGuard = _NOT_ENTERED;
  }

  ///  @dev Internal view function to ensure that the sentinel value for the
  /// reentrancy guard is not currently set.
  function _assertNonReentrant() internal view {
    if (_reentrancyGuard != _NOT_ENTERED) {
      _revertNoReentrantCalls();
    }
  }
}