pragma solidity ^0.8.13;
import { EIP1271Interface } from "../interfaces/EIP1271Interface.sol";
import { SignatureVerificationErrors } from "../interfaces/SignatureVerificationErrors.sol";
import { LowLevelHelpers } from "./LowLevelHelpers.sol";
import "./ConsiderationErrors.sol";

contract SignatureVerification is SignatureVerificationErrors, LowLevelHelpers {

  function _assertValidSignature(address signer, bytes32 digest, bytes memory signature) internal view {
    bool success;
    assembly {
      mstore(0, 0)
      let v
      let signatureLength := mload(signature)
      let wordBeforeSignaturePtr := sub(signature, OneWord)
      let cachedWordBeforeSignature := mload(wordBeforeSignaturePtr)
      {
        let lenDiff := sub(ECDSA_MaxLength, signatureLength)
        let recoveredSigner
        if iszero(gt(lenDiff, 1)) {
          let originalSignatureS := mload(add(signature, ECDSA_signature_s_offset))
          v := byte(0, mload(add(signature, ECDSA_signature_v_offset)))
          if lenDiff {
            v := add(shr(MaxUint8, originalSignatureS), Signature_lower_v)
            mstore(add(signature, ECDSA_signature_s_offset), and(originalSignatureS, EIP2098_allButHighestBitMask))
          }
          mstore(signature, v)
          mstore(wordBeforeSignaturePtr, digest)
          pop(staticcall(gas(), Ecrecover_precompile, wordBeforeSignaturePtr, Ecrecover_args_size, 0, OneWord))
          mstore(wordBeforeSignaturePtr, cachedWordBeforeSignature)
          mstore(signature, signatureLength)
          mstore(add(signature, ECDSA_signature_s_offset), originalSignatureS)
          recoveredSigner := mload(0)
        }
        success := and(eq(signer, recoveredSigner), gt(signer, 0))
      }
      if iszero(success) {
        mstore(wordBeforeSignaturePtr, EIP1271_isValidSignature_signature_head_offset)
        let selectorPtr := sub(signature, EIP1271_isValidSignature_selector_negativeOffset)
        let cachedWordOverwrittenBySelector := mload(selectorPtr)
        let digestPtr := sub(signature, EIP1271_isValidSignature_digest_negativeOffset)
        let cachedWordOverwrittenByDigest := mload(digestPtr)
        mstore(selectorPtr, EIP1271_isValidSignature_selector)
        mstore(digestPtr, digest)
        success := staticcall(gas(), signer, selectorPtr, add(signatureLength, EIP1271_isValidSignature_calldata_baseLength), 0, OneWord)
        if success {
          if iszero(eq(mload(0), EIP1271_isValidSignature_selector)) {
            if extcodesize(signer) {
              mstore(0, BadContractSignature_error_selector)
              revert(0x1c, BadContractSignature_error_length)
            }
            if gt(sub(ECDSA_MaxLength, signatureLength), 1) {
              mstore(0, InvalidSignature_error_selector)
              revert(0x1c, InvalidSignature_error_length)
            }
            if iszero(byte(v, ECDSA_twentySeventhAndTwentyEighthBytesSet)) {
              mstore(0, BadSignatureV_error_selector)
              mstore(BadSignatureV_error_v_ptr, v)
              revert(0x1c, BadSignatureV_error_length)
            }
            mstore(0, InvalidSigner_error_selector)
            revert(0x1c, InvalidSigner_error_length)
          }
        }
        mstore(wordBeforeSignaturePtr, cachedWordBeforeSignature)
        mstore(selectorPtr, cachedWordOverwrittenBySelector)
        mstore(digestPtr, cachedWordOverwrittenByDigest)
      }
    }
    if (!success) {
      _revertWithReasonIfOneIsReturned();
      assembly {
        mstore(0, BadContractSignature_error_selector)
        revert(0x1c, BadContractSignature_error_length)
      }
    }
  }
}