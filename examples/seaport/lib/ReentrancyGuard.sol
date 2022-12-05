pragma solidity ^0.8.13;
import { ReentrancyErrors } from "../interfaces/ReentrancyErrors.sol";
import "./ConsiderationErrors.sol";

contract ReentrancyGuard is ReentrancyErrors {
  uint256 private _reentrancyGuard;

  constructor() {
    _reentrancyGuard = _NOT_ENTERED;
  }

  function _setReentrancyGuard() internal {
    _assertNonReentrant();
    _reentrancyGuard = _ENTERED;
  }

  function _clearReentrancyGuard() internal {
    _reentrancyGuard = _NOT_ENTERED;
  }

  function _assertNonReentrant() internal view {
    if (_reentrancyGuard != _NOT_ENTERED) {
      _revertNoReentrantCalls();
    }
  }
}