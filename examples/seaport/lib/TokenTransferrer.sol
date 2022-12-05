pragma solidity ^0.8.7;
import "./TokenTransferrerConstants.sol";
import { TokenTransferrerErrors } from "../interfaces/TokenTransferrerErrors.sol";
import { ConduitBatch1155Transfer } from "../conduit/lib/ConduitStructs.sol";

contract TokenTransferrer is TokenTransferrerErrors {

  function _performERC20Transfer(address token, address from, address to, uint256 amount) internal {
    assembly {
      let memPointer := mload(FreeMemoryPointerSlot)
      mstore(ERC20_transferFrom_sig_ptr, ERC20_transferFrom_signature)
      mstore(ERC20_transferFrom_from_ptr, from)
      mstore(ERC20_transferFrom_to_ptr, to)
      mstore(ERC20_transferFrom_amount_ptr, amount)
      let callStatus := call(gas(), token, 0, ERC20_transferFrom_sig_ptr, ERC20_transferFrom_length, 0, OneWord)
      let success := and(or(and(eq(mload(0), 1), gt(returndatasize(), 31)), iszero(returndatasize())), callStatus)
      if iszero(and(success, iszero(iszero(returndatasize())))) {
        if iszero(and(iszero(iszero(extcodesize(token))), success)) {
          if iszero(success) {
            if iszero(callStatus) {
              if returndatasize() {
                let returnDataWords := div(add(returndatasize(), AlmostOneWord), OneWord)
                let msizeWords := div(memPointer, OneWord)
                let cost := mul(CostPerWord, returnDataWords)
                if gt(returnDataWords, msizeWords) {
                  cost := add(cost, add(mul(sub(returnDataWords, msizeWords), CostPerWord), div(sub(mul(returnDataWords, returnDataWords), mul(msizeWords, msizeWords)), MemoryExpansionCoefficient)))
                }
                if lt(add(cost, ExtraGasBuffer), gas()) {
                  returndatacopy(0, 0, returndatasize())
                  revert(0, returndatasize())
                }
              }
              mstore(0, TokenTransferGenericFailure_error_selector)
              mstore(TokenTransferGenericFailure_error_token_ptr, token)
              mstore(TokenTransferGenericFailure_error_from_ptr, from)
              mstore(TokenTransferGenericFailure_error_to_ptr, to)
              mstore(TokenTransferGenericFailure_error_identifier_ptr, 0)
              mstore(TokenTransferGenericFailure_error_amount_ptr, amount)
              revert(0x1c, TokenTransferGenericFailure_error_length)
            }
            mstore(0, BadReturnValueFromERC20OnTransfer_error_selector)
            mstore(BadReturnValueFromERC20OnTransfer_error_token_ptr, token)
            mstore(BadReturnValueFromERC20OnTransfer_error_from_ptr, from)
            mstore(BadReturnValueFromERC20OnTransfer_error_to_ptr, to)
            mstore(BadReturnValueFromERC20OnTransfer_error_amount_ptr, amount)
            revert(0x1c, BadReturnValueFromERC20OnTransfer_error_length)
          }
          mstore(0, NoContract_error_selector)
          mstore(NoContract_error_account_ptr, token)
          revert(0x1c, NoContract_error_length)
        }
      }
      mstore(FreeMemoryPointerSlot, memPointer)
      mstore(ZeroSlot, 0)
    }
  }

  function _performERC721Transfer(address token, address from, address to, uint256 identifier) internal {
    assembly {
      if iszero(extcodesize(token)) {
        mstore(0, NoContract_error_selector)
        mstore(NoContract_error_account_ptr, token)
        revert(0x1c, NoContract_error_length)
      }
      let memPointer := mload(FreeMemoryPointerSlot)
      mstore(ERC721_transferFrom_sig_ptr, ERC721_transferFrom_signature)
      mstore(ERC721_transferFrom_from_ptr, from)
      mstore(ERC721_transferFrom_to_ptr, to)
      mstore(ERC721_transferFrom_id_ptr, identifier)
      let success := call(gas(), token, 0, ERC721_transferFrom_sig_ptr, ERC721_transferFrom_length, 0, 0)
      if iszero(success) {
        if returndatasize() {
          let returnDataWords := div(add(returndatasize(), AlmostOneWord), OneWord)
          let msizeWords := div(memPointer, OneWord)
          let cost := mul(CostPerWord, returnDataWords)
          if gt(returnDataWords, msizeWords) {
            cost := add(cost, add(mul(sub(returnDataWords, msizeWords), CostPerWord), div(sub(mul(returnDataWords, returnDataWords), mul(msizeWords, msizeWords)), MemoryExpansionCoefficient)))
          }
          if lt(add(cost, ExtraGasBuffer), gas()) {
            returndatacopy(0, 0, returndatasize())
            revert(0, returndatasize())
          }
        }
        mstore(0, TokenTransferGenericFailure_error_selector)
        mstore(TokenTransferGenericFailure_error_token_ptr, token)
        mstore(TokenTransferGenericFailure_error_from_ptr, from)
        mstore(TokenTransferGenericFailure_error_to_ptr, to)
        mstore(TokenTransferGenericFailure_error_identifier_ptr, identifier)
        mstore(TokenTransferGenericFailure_error_amount_ptr, 1)
        revert(0x1c, TokenTransferGenericFailure_error_length)
      }
      mstore(FreeMemoryPointerSlot, memPointer)
      mstore(ZeroSlot, 0)
    }
  }

  function _performERC1155Transfer(address token, address from, address to, uint256 identifier, uint256 amount) internal {
    assembly {
      if iszero(extcodesize(token)) {
        mstore(0, NoContract_error_selector)
        mstore(NoContract_error_account_ptr, token)
        revert(0x1c, NoContract_error_length)
      }
      let memPointer := mload(FreeMemoryPointerSlot)
      let slot0x80 := mload(Slot0x80)
      let slot0xA0 := mload(Slot0xA0)
      let slot0xC0 := mload(Slot0xC0)
      mstore(ERC1155_safeTransferFrom_sig_ptr, ERC1155_safeTransferFrom_signature)
      mstore(ERC1155_safeTransferFrom_from_ptr, from)
      mstore(ERC1155_safeTransferFrom_to_ptr, to)
      mstore(ERC1155_safeTransferFrom_id_ptr, identifier)
      mstore(ERC1155_safeTransferFrom_amount_ptr, amount)
      mstore(ERC1155_safeTransferFrom_data_offset_ptr, ERC1155_safeTransferFrom_data_length_offset)
      mstore(ERC1155_safeTransferFrom_data_length_ptr, 0)
      let success := call(gas(), token, 0, ERC1155_safeTransferFrom_sig_ptr, ERC1155_safeTransferFrom_length, 0, 0)
      if iszero(success) {
        if returndatasize() {
          let returnDataWords := div(add(returndatasize(), AlmostOneWord), OneWord)
          let msizeWords := div(memPointer, OneWord)
          let cost := mul(CostPerWord, returnDataWords)
          if gt(returnDataWords, msizeWords) {
            cost := add(cost, add(mul(sub(returnDataWords, msizeWords), CostPerWord), div(sub(mul(returnDataWords, returnDataWords), mul(msizeWords, msizeWords)), MemoryExpansionCoefficient)))
          }
          if lt(add(cost, ExtraGasBuffer), gas()) {
            returndatacopy(0, 0, returndatasize())
            revert(0, returndatasize())
          }
        }
        mstore(0, TokenTransferGenericFailure_error_selector)
        mstore(TokenTransferGenericFailure_error_token_ptr, token)
        mstore(TokenTransferGenericFailure_error_from_ptr, from)
        mstore(TokenTransferGenericFailure_error_to_ptr, to)
        mstore(TokenTransferGenericFailure_error_identifier_ptr, identifier)
        mstore(TokenTransferGenericFailure_error_amount_ptr, amount)
        revert(0x1c, TokenTransferGenericFailure_error_length)
      }
      mstore(Slot0x80, slot0x80)
      mstore(Slot0xA0, slot0xA0)
      mstore(Slot0xC0, slot0xC0)
      mstore(FreeMemoryPointerSlot, memPointer)
      mstore(ZeroSlot, 0)
    }
  }

  function _performERC1155BatchTransfers(ConduitBatch1155Transfer[] calldata batchTransfers) internal {
    assembly {
      let len := batchTransfers.length
      let nextElementHeadPtr := batchTransfers.offset
      let arrayHeadPtr := nextElementHeadPtr
      mstore(ConduitBatch1155Transfer_from_offset, ERC1155_safeBatchTransferFrom_signature)
      for {
        let i := 0
      } lt(i, len) {
        i := add(i, 1)
      } {
        let elementPtr := add(arrayHeadPtr, calldataload(nextElementHeadPtr))
        let token := calldataload(elementPtr)
        if iszero(extcodesize(token)) {
          mstore(0, NoContract_error_selector)
          mstore(NoContract_error_account_ptr, token)
          revert(0x1c, NoContract_error_length)
        }
        let idsLength := calldataload(add(elementPtr, ConduitBatch1155Transfer_ids_length_offset))
        let expectedAmountsOffset := add(ConduitBatch1155Transfer_amounts_length_baseOffset, mul(idsLength, OneWord))
        let invalidEncoding := iszero(and(eq(idsLength, calldataload(add(elementPtr, expectedAmountsOffset))), and(eq(calldataload(add(elementPtr, ConduitBatch1155Transfer_ids_head_offset)), ConduitBatch1155Transfer_ids_length_offset), eq(calldataload(add(elementPtr, ConduitBatchTransfer_amounts_head_offset)), expectedAmountsOffset))))
        if invalidEncoding {
          mstore(Invalid1155BatchTransferEncoding_ptr, Invalid1155BatchTransferEncoding_selector)
          revert(Invalid1155BatchTransferEncoding_ptr, Invalid1155BatchTransferEncoding_length)
        }
        nextElementHeadPtr := add(nextElementHeadPtr, OneWord)
        calldatacopy(BatchTransfer1155Params_ptr, add(elementPtr, ConduitBatch1155Transfer_from_offset), ConduitBatch1155Transfer_usable_head_size)
        let idsAndAmountsSize := add(TwoWords, mul(idsLength, TwoWords))
        mstore(BatchTransfer1155Params_data_head_ptr, add(BatchTransfer1155Params_ids_length_offset, idsAndAmountsSize))
        mstore(add(BatchTransfer1155Params_data_length_basePtr, idsAndAmountsSize), 0)
        let transferDataSize := add(BatchTransfer1155Params_calldata_baseSize, idsAndAmountsSize)
        calldatacopy(BatchTransfer1155Params_ids_length_ptr, add(elementPtr, ConduitBatch1155Transfer_ids_length_offset), idsAndAmountsSize)
        let success := call(gas(), token, 0, ConduitBatch1155Transfer_from_offset, transferDataSize, 0, 0)
        if iszero(success) {
          if returndatasize() {
            let returnDataWords := div(add(returndatasize(), AlmostOneWord), OneWord)
            let msizeWords := div(transferDataSize, OneWord)
            let cost := mul(CostPerWord, returnDataWords)
            if gt(returnDataWords, msizeWords) {
              cost := add(cost, add(mul(sub(returnDataWords, msizeWords), CostPerWord), div(sub(mul(returnDataWords, returnDataWords), mul(msizeWords, msizeWords)), MemoryExpansionCoefficient)))
            }
            if lt(add(cost, ExtraGasBuffer), gas()) {
              returndatacopy(0, 0, returndatasize())
              revert(0, returndatasize())
            }
          }
          mstore(0, ERC1155BatchTransferGenericFailure_error_signature)
          mstore(ERC1155BatchTransferGenericFailure_token_ptr, token)
          mstore(BatchTransfer1155Params_ids_head_ptr, ERC1155BatchTransferGenericFailure_ids_offset)
          mstore(BatchTransfer1155Params_amounts_head_ptr, add(OneWord, mload(BatchTransfer1155Params_amounts_head_ptr)))
          revert(0, transferDataSize)
        }
      }
      mstore(FreeMemoryPointerSlot, DefaultFreeMemoryPointer)
    }
  }
}