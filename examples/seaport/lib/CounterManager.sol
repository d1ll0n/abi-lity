pragma solidity ^0.8.13;

import { ConsiderationEventsAndErrors } from "../interfaces/ConsiderationEventsAndErrors.sol";
import { ReentrancyGuard } from "./ReentrancyGuard.sol";

///  @title CounterManager
///  @author 0age
///  @notice CounterManager contains a storage mapping and related functionality
///          for retrieving and incrementing a per-offerer counter.
contract CounterManager is ConsiderationEventsAndErrors, ReentrancyGuard {
  mapping(address => uint256) private _counters;

  ///  @dev Internal function to cancel all orders from a given offerer with a
  ///       given zone in bulk by incrementing a counter. Note that only the
  ///       offerer may increment the counter.
  ///  @return newCounter The new counter.
  function _incrementCounter() internal returns (uint256 newCounter) {
    _assertNonReentrant();
    unchecked {
      newCounter = ++_counters[msg.sender];
    }
    emit CounterIncremented(newCounter, msg.sender);
  }

  ///  @dev Internal view function to retrieve the current counter for a given
  ///       offerer.
  ///  @param offerer The offerer in question.
  ///  @return currentCounter The current counter.
  function _getCounter(address offerer) internal view returns (uint256 currentCounter) {
    currentCounter = _counters[offerer];
  }
}