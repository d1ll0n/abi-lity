pragma solidity ^0.8.13;
import { ConsiderationEventsAndErrors } from "../interfaces/ConsiderationEventsAndErrors.sol";
import { ReentrancyGuard } from "./ReentrancyGuard.sol";

contract CounterManager is ConsiderationEventsAndErrors, ReentrancyGuard {
  mapping(address => uint256) private _counters;

  function _incrementCounter() internal returns (uint256 newCounter) {
    _assertNonReentrant();
    unchecked {
      newCounter = ++_counters[msg.sender];
    }
    emit CounterIncremented(newCounter, msg.sender);
  }

  function _getCounter(address offerer) internal view returns (uint256 currentCounter) {
    currentCounter = _counters[offerer];
  }
}