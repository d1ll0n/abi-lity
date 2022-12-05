pragma solidity ^0.8.13;

import { ConduitInterface } from "../interfaces/ConduitInterface.sol";
import { ConduitItemType } from "../conduit/lib/ConduitEnums.sol";
import { ItemType } from "./ConsiderationEnums.sol";
import { ReceivedItem } from "./ConsiderationStructs.sol";
import { Verifiers } from "./Verifiers.sol";
import { TokenTransferrer } from "./TokenTransferrer.sol";
import "./ConsiderationConstants.sol";
import "./ConsiderationErrors.sol";

/// @title Executor
///   @author 0age
///   @notice Executor contains functions related to processing executions (i.e.
///           transferring items, either directly or via conduits).
contract Executor is Verifiers, TokenTransferrer {
  /// @dev Derive and set hashes, reference chainId, and associated domain
  ///        separator during deployment.
  ///   @param conduitController A contract that deploys conduits, or proxies
  ///                            that may optionally be used to transfer approved
  ///                            ERC20/721/1155 tokens.
  constructor(address conduitController) Verifiers(conduitController) {}

  /// @dev Internal function to transfer a given item, either directly or via
  ///        a corresponding conduit.
  ///   @param item        The item to transfer, including an amount and a
  ///                      recipient.
  ///   @param from        The account supplying the item.
  ///   @param conduitKey  A bytes32 value indicating what corresponding conduit,
  ///                      if any, to source token approvals from. The zero hash
  ///                      signifies that no conduit should be used, with direct
  ///                      approvals set on this contract.
  ///   @param accumulator An open-ended array that collects transfers to execute
  ///                      against a given conduit in a single call.
  function _transfer(ReceivedItem memory item, address from, bytes32 conduitKey, bytes memory accumulator) internal {
    if (item.itemType == ItemType.NATIVE) {
      if ((uint160(item.token) | item.identifier) != 0) {
        _revertUnusedItemParameters();
      }
      _transferEth(item.recipient, item.amount);
    } else if (item.itemType == ItemType.ERC20) {
      if (item.identifier != 0) {
        _revertUnusedItemParameters();
      }
      _transferERC20(item.token, from, item.recipient, item.amount, conduitKey, accumulator);
    } else if (item.itemType == ItemType.ERC721) {
      _transferERC721(item.token, from, item.recipient, item.identifier, item.amount, conduitKey, accumulator);
    } else {
      _transferERC1155(item.token, from, item.recipient, item.identifier, item.amount, conduitKey, accumulator);
    }
  }

  /// @dev Internal function to transfer an individual ERC721 or ERC1155 item
  ///        from a given originator to a given recipient. The accumulator will
  ///        be bypassed, meaning that this function should be utilized in cases
  ///        where multiple item transfers can be accumulated into a single
  ///        conduit call. Sufficient approvals must be set, either on the
  ///        respective conduit or on this contract itself.
  ///   @param itemType   The type of item to transfer, either ERC721 or ERC1155.
  ///   @param token      The token to transfer.
  ///   @param from       The originator of the transfer.
  ///   @param to         The recipient of the transfer.
  ///   @param identifier The tokenId to transfer.
  ///   @param amount     The amount to transfer.
  ///   @param conduitKey A bytes32 value indicating what corresponding conduit,
  ///                     if any, to source token approvals from. The zero hash
  ///                     signifies that no conduit should be used, with direct
  ///                     approvals set on this contract.
  function _transferIndividual721Or1155Item(ItemType itemType, address token, address from, address to, uint256 identifier, uint256 amount, bytes32 conduitKey) internal {
    if (conduitKey != bytes32(0)) {
      uint256 callDataOffset;
      assembly {
        callDataOffset := mload(FreeMemoryPointerSlot)
        mstore(callDataOffset, Conduit_execute_signature)
        mstore(add(callDataOffset, Conduit_execute_ConduitTransfer_offset_ptr), Conduit_execute_ConduitTransfer_ptr)
        mstore(add(callDataOffset, Conduit_execute_ConduitTransfer_length_ptr), Conduit_execute_ConduitTransfer_length)
        mstore(add(callDataOffset, Conduit_execute_transferItemType_ptr), itemType)
        mstore(add(callDataOffset, Conduit_execute_transferToken_ptr), token)
        mstore(add(callDataOffset, Conduit_execute_transferFrom_ptr), from)
        mstore(add(callDataOffset, Conduit_execute_transferTo_ptr), to)
        mstore(add(callDataOffset, Conduit_execute_transferIdentifier_ptr), identifier)
        mstore(add(callDataOffset, Conduit_execute_transferAmount_ptr), amount)
      }
      _callConduitUsingOffsets(conduitKey, callDataOffset, OneConduitExecute_size);
    } else {
      if (itemType == ItemType.ERC721) {
        if (amount != 1) {
          _revertInvalidERC721TransferAmount();
        }
        _performERC721Transfer(token, from, to, identifier);
      } else {
        _performERC1155Transfer(token, from, to, identifier, amount);
      }
    }
  }

  /// @dev Internal function to transfer Ether or other native tokens to a
  ///        given recipient.
  ///   @param to     The recipient of the transfer.
  ///   @param amount The amount to transfer.
  function _transferEth(address payable to, uint256 amount) internal {
    _assertNonZeroAmount(amount);
    bool success;
    assembly {
      success := call(gas(), to, amount, 0, 0, 0, 0)
    }
    if (!success) {
      _revertWithReasonIfOneIsReturned();
      assembly {
        mstore(0, EtherTransferGenericFailure_error_selector)
        mstore(EtherTransferGenericFailure_error_account_ptr, to)
        mstore(EtherTransferGenericFailure_error_amount_ptr, amount)
        revert(0x1c, EtherTransferGenericFailure_error_length)
      }
    }
  }

  /// @dev Internal function to transfer ERC20 tokens from a given originator
  ///        to a given recipient using a given conduit if applicable. Sufficient
  ///        approvals must be set on this contract or on a respective conduit.
  ///   @param token       The ERC20 token to transfer.
  ///   @param from        The originator of the transfer.
  ///   @param to          The recipient of the transfer.
  ///   @param amount      The amount to transfer.
  ///   @param conduitKey  A bytes32 value indicating what corresponding conduit,
  ///                      if any, to source token approvals from. The zero hash
  ///                      signifies that no conduit should be used, with direct
  ///                      approvals set on this contract.
  ///   @param accumulator An open-ended array that collects transfers to execute
  ///                      against a given conduit in a single call.
  function _transferERC20(address token, address from, address to, uint256 amount, bytes32 conduitKey, bytes memory accumulator) internal {
    _assertNonZeroAmount(amount);
    _triggerIfArmedAndNotAccumulatable(accumulator, conduitKey);
    if (conduitKey == bytes32(0)) {
      _performERC20Transfer(token, from, to, amount);
    } else {
      _insert(conduitKey, accumulator, ConduitItemType.ERC20, token, from, to, uint256(0), amount);
    }
  }

  /// @dev Internal function to transfer a single ERC721 token from a given
  ///        originator to a given recipient. Sufficient approvals must be set,
  ///        either on the respective conduit or on this contract itself.
  ///   @param token       The ERC721 token to transfer.
  ///   @param from        The originator of the transfer.
  ///   @param to          The recipient of the transfer.
  ///   @param identifier  The tokenId to transfer (must be 1 for ERC721).
  ///   @param amount      The amount to transfer.
  ///   @param conduitKey  A bytes32 value indicating what corresponding conduit,
  ///                      if any, to source token approvals from. The zero hash
  ///                      signifies that no conduit should be used, with direct
  ///                      approvals set on this contract.
  ///   @param accumulator An open-ended array that collects transfers to execute
  ///                      against a given conduit in a single call.
  function _transferERC721(address token, address from, address to, uint256 identifier, uint256 amount, bytes32 conduitKey, bytes memory accumulator) internal {
    _triggerIfArmedAndNotAccumulatable(accumulator, conduitKey);
    if (conduitKey == bytes32(0)) {
      if (amount != 1) {
        _revertInvalidERC721TransferAmount();
      }
      _performERC721Transfer(token, from, to, identifier);
    } else {
      _insert(conduitKey, accumulator, ConduitItemType.ERC721, token, from, to, identifier, amount);
    }
  }

  /// @dev Internal function to transfer ERC1155 tokens from a given originator
  ///        to a given recipient. Sufficient approvals must be set, either on
  ///        the respective conduit or on this contract itself.
  ///   @param token       The ERC1155 token to transfer.
  ///   @param from        The originator of the transfer.
  ///   @param to          The recipient of the transfer.
  ///   @param identifier  The id to transfer.
  ///   @param amount      The amount to transfer.
  ///   @param conduitKey  A bytes32 value indicating what corresponding conduit,
  ///                      if any, to source token approvals from. The zero hash
  ///                      signifies that no conduit should be used, with direct
  ///                      approvals set on this contract.
  ///   @param accumulator An open-ended array that collects transfers to execute
  ///                      against a given conduit in a single call.
  function _transferERC1155(address token, address from, address to, uint256 identifier, uint256 amount, bytes32 conduitKey, bytes memory accumulator) internal {
    _assertNonZeroAmount(amount);
    _triggerIfArmedAndNotAccumulatable(accumulator, conduitKey);
    if (conduitKey == bytes32(0)) {
      _performERC1155Transfer(token, from, to, identifier, amount);
    } else {
      _insert(conduitKey, accumulator, ConduitItemType.ERC1155, token, from, to, identifier, amount);
    }
  }

  /// @dev Internal function to trigger a call to the conduit currently held by
  ///        the accumulator if the accumulator contains item transfers (i.e. it
  ///        is "armed") and the supplied conduit key does not match the key held
  ///        by the accumulator.
  ///   @param accumulator An open-ended array that collects transfers to execute
  ///                      against a given conduit in a single call.
  ///   @param conduitKey  A bytes32 value indicating what corresponding conduit,
  ///                      if any, to source token approvals from. The zero hash
  ///                      signifies that no conduit should be used, with direct
  ///                      approvals set on this contract.
  function _triggerIfArmedAndNotAccumulatable(bytes memory accumulator, bytes32 conduitKey) internal {
    bytes32 accumulatorConduitKey = _getAccumulatorConduitKey(accumulator);
    if (accumulatorConduitKey != conduitKey) {
      _triggerIfArmed(accumulator);
    }
  }

  /// @dev Internal function to trigger a call to the conduit currently held by
  ///        the accumulator if the accumulator contains item transfers (i.e. it
  ///        is "armed").
  ///   @param accumulator An open-ended array that collects transfers to execute
  ///                      against a given conduit in a single call.
  function _triggerIfArmed(bytes memory accumulator) internal {
    if (accumulator.length != AccumulatorArmed) {
      return;
    }
    bytes32 accumulatorConduitKey = _getAccumulatorConduitKey(accumulator);
    _trigger(accumulatorConduitKey, accumulator);
  }

  /// @dev Internal function to trigger a call to the conduit corresponding to
  ///        a given conduit key, supplying all accumulated item transfers. The
  ///        accumulator will be "disarmed" and reset in the process.
  ///   @param conduitKey  A bytes32 value indicating what corresponding conduit,
  ///                      if any, to source token approvals from. The zero hash
  ///                      signifies that no conduit should be used, with direct
  ///                      approvals set on this contract.
  ///   @param accumulator An open-ended array that collects transfers to execute
  ///                      against a given conduit in a single call.
  function _trigger(bytes32 conduitKey, bytes memory accumulator) internal {
    uint256 callDataOffset;
    uint256 callDataSize;
    assembly {
      callDataOffset := add(accumulator, TwoWords)
      callDataSize := add(Accumulator_array_offset_ptr, mul(mload(add(accumulator, Accumulator_array_length_ptr)), Conduit_transferItem_size))
    }
    _callConduitUsingOffsets(conduitKey, callDataOffset, callDataSize);
    assembly {
      mstore(accumulator, AccumulatorDisarmed)
    }
  }

  /// @dev Internal function to perform a call to the conduit corresponding to
  ///        a given conduit key based on the offset and size of the calldata in
  ///        question in memory.
  ///   @param conduitKey     A bytes32 value indicating what corresponding
  ///                         conduit, if any, to source token approvals from.
  ///                         The zero hash signifies that no conduit should be
  ///                         used, with direct approvals set on this contract.
  ///   @param callDataOffset The memory pointer where calldata is contained.
  ///   @param callDataSize   The size of calldata in memory.
  function _callConduitUsingOffsets(bytes32 conduitKey, uint256 callDataOffset, uint256 callDataSize) internal {
    address conduit = _deriveConduit(conduitKey);
    bool success;
    bytes4 result;
    assembly {
      mstore(0, 0)
      success := call(gas(), conduit, 0, callDataOffset, callDataSize, 0, OneWord)
      result := mload(0)
    }
    if (!success) {
      _revertWithReasonIfOneIsReturned();
      _revertInvalidCallToConduit(conduit);
    }
    if (result != ConduitInterface.execute.selector) {
      _revertInvalidConduit(conduitKey, conduit);
    }
  }

  /// @dev Internal pure function to retrieve the current conduit key set for
  ///        the accumulator.
  ///   @param accumulator An open-ended array that collects transfers to execute
  ///                      against a given conduit in a single call.
  ///   @return accumulatorConduitKey The conduit key currently set for the
  ///                                 accumulator.
  function _getAccumulatorConduitKey(bytes memory accumulator) internal pure returns (bytes32 accumulatorConduitKey) {
    assembly {
      accumulatorConduitKey := mload(add(accumulator, Accumulator_conduitKey_ptr))
    }
  }

  /// @dev Internal pure function to place an item transfer into an accumulator
  ///        that collects a series of transfers to execute against a given
  ///        conduit in a single call.
  ///   @param conduitKey  A bytes32 value indicating what corresponding conduit,
  ///                      if any, to source token approvals from. The zero hash
  ///                      signifies that no conduit should be used, with direct
  ///                      approvals set on this contract.
  ///   @param accumulator An open-ended array that collects transfers to execute
  ///                      against a given conduit in a single call.
  ///   @param itemType    The type of the item to transfer.
  ///   @param token       The token to transfer.
  ///   @param from        The originator of the transfer.
  ///   @param to          The recipient of the transfer.
  ///   @param identifier  The tokenId to transfer.
  ///   @param amount      The amount to transfer.
  function _insert(bytes32 conduitKey, bytes memory accumulator, ConduitItemType itemType, address token, address from, address to, uint256 identifier, uint256 amount) internal pure {
    uint256 elements;
    if (accumulator.length == AccumulatorDisarmed) {
      elements = 1;
      bytes4 selector = ConduitInterface.execute.selector;
      assembly {
        mstore(accumulator, AccumulatorArmed)
        mstore(add(accumulator, Accumulator_conduitKey_ptr), conduitKey)
        mstore(add(accumulator, Accumulator_selector_ptr), selector)
        mstore(add(accumulator, Accumulator_array_offset_ptr), Accumulator_array_offset)
        mstore(add(accumulator, Accumulator_array_length_ptr), elements)
      }
    } else {
      assembly {
        elements := add(mload(add(accumulator, Accumulator_array_length_ptr)), 1)
        mstore(add(accumulator, Accumulator_array_length_ptr), elements)
      }
    }
    assembly {
      let itemPointer := sub(add(accumulator, mul(elements, Conduit_transferItem_size)), Accumulator_itemSizeOffsetDifference)
      mstore(itemPointer, itemType)
      mstore(add(itemPointer, Conduit_transferItem_token_ptr), token)
      mstore(add(itemPointer, Conduit_transferItem_from_ptr), from)
      mstore(add(itemPointer, Conduit_transferItem_to_ptr), to)
      mstore(add(itemPointer, Conduit_transferItem_identifier_ptr), identifier)
      mstore(add(itemPointer, Conduit_transferItem_amount_ptr), amount)
    }
  }
}