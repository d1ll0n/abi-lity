pragma solidity ^0.8.13;
import { ConduitInterface } from "../interfaces/ConduitInterface.sol";
import { ConduitItemType } from "../conduit/lib/ConduitEnums.sol";
import { ItemType } from "./ConsiderationEnums.sol";
import { ReceivedItem } from "./ConsiderationStructs.sol";
import { Verifiers } from "./Verifiers.sol";
import { TokenTransferrer } from "./TokenTransferrer.sol";
import "./ConsiderationConstants.sol";
import "./ConsiderationErrors.sol";

contract Executor is Verifiers, TokenTransferrer {

  constructor(address conduitController) Verifiers(conduitController) {}

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

  function _transferERC20(address token, address from, address to, uint256 amount, bytes32 conduitKey, bytes memory accumulator) internal {
    _assertNonZeroAmount(amount);
    _triggerIfArmedAndNotAccumulatable(accumulator, conduitKey);
    if (conduitKey == bytes32(0)) {
      _performERC20Transfer(token, from, to, amount);
    } else {
      _insert(conduitKey, accumulator, ConduitItemType.ERC20, token, from, to, uint256(0), amount);
    }
  }

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

  function _transferERC1155(address token, address from, address to, uint256 identifier, uint256 amount, bytes32 conduitKey, bytes memory accumulator) internal {
    _assertNonZeroAmount(amount);
    _triggerIfArmedAndNotAccumulatable(accumulator, conduitKey);
    if (conduitKey == bytes32(0)) {
      _performERC1155Transfer(token, from, to, identifier, amount);
    } else {
      _insert(conduitKey, accumulator, ConduitItemType.ERC1155, token, from, to, identifier, amount);
    }
  }

  function _triggerIfArmedAndNotAccumulatable(bytes memory accumulator, bytes32 conduitKey) internal {
    bytes32 accumulatorConduitKey = _getAccumulatorConduitKey(accumulator);
    if (accumulatorConduitKey != conduitKey) {
      _triggerIfArmed(accumulator);
    }
  }

  function _triggerIfArmed(bytes memory accumulator) internal {
    if (accumulator.length != AccumulatorArmed) {
      return;
    }
    bytes32 accumulatorConduitKey = _getAccumulatorConduitKey(accumulator);
    _trigger(accumulatorConduitKey, accumulator);
  }

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

  function _getAccumulatorConduitKey(bytes memory accumulator) internal pure returns (bytes32 accumulatorConduitKey) {
    assembly {
      accumulatorConduitKey := mload(add(accumulator, Accumulator_conduitKey_ptr))
    }
  }

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