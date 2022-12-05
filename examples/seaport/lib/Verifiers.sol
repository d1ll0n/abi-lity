pragma solidity ^0.8.13;
import { OrderStatus } from "./ConsiderationStructs.sol";
import { Assertions } from "./Assertions.sol";
import { SignatureVerification } from "./SignatureVerification.sol";
import "./ConsiderationErrors.sol";

contract Verifiers is Assertions, SignatureVerification {

  constructor(address conduitController) Assertions(conduitController) {}

  function _verifyTime(uint256 startTime, uint256 endTime, bool revertOnInvalid) internal view returns (bool valid) {
    assembly {
      valid := and(iszero(gt(startTime, timestamp())), gt(endTime, timestamp()))
    }
    if (revertOnInvalid && (!valid)) {
      _revertInvalidTime();
    }
  }

  function _verifySignature(address offerer, bytes32 orderHash, bytes memory signature) internal view {
    if (_unmaskedAddressComparison(offerer, msg.sender)) {
      return;
    }
    if (_isValidBulkOrderSize(signature)) {
      (orderHash) = _computeBulkOrderProof(signature, orderHash);
    }
    bytes32 digest = _deriveEIP712Digest(_domainSeparator(), orderHash);
    _assertValidSignature(offerer, digest, signature);
  }
  function _isValidBulkOrderSize(bytes memory signature) internal pure returns (bool validLength) {
    assembly {
      validLength := lt(sub(mload(signature), EIP712_BulkOrder_minSize), 2)
    }
  }
  function _computeBulkOrderProof(bytes memory proofAndSignature, bytes32 leaf) internal view returns (bytes32 bulkOrderHash) {
    bytes32 root;
    assembly {
      let length := sub(mload(proofAndSignature), BulkOrderProof_proofAndKeySize)
      mstore(proofAndSignature, length)
      let keyPtr := add(proofAndSignature, add(0x20, length))
      let key := shr(248, mload(keyPtr))
      let proof := add(keyPtr, 1)
      let scratch := shl(5, and(key, 1))
      mstore(scratch, leaf)
      mstore(xor(scratch, OneWord), mload(proof))
      scratch := shl(5, and(shr(1, key), 1))
      mstore(scratch, keccak256(0, TwoWords))
      mstore(xor(scratch, OneWord), mload(add(proof, 0x20)))
      scratch := shl(5, and(shr(2, key), 1))
      mstore(scratch, keccak256(0, TwoWords))
      mstore(xor(scratch, OneWord), mload(add(proof, 0x40)))
      scratch := shl(5, and(shr(3, key), 1))
      mstore(scratch, keccak256(0, TwoWords))
      mstore(xor(scratch, OneWord), mload(add(proof, 0x60)))
      scratch := shl(5, and(shr(4, key), 1))
      mstore(scratch, keccak256(0, TwoWords))
      mstore(xor(scratch, OneWord), mload(add(proof, 0x80)))
      scratch := shl(5, and(shr(5, key), 1))
      mstore(scratch, keccak256(0, TwoWords))
      mstore(xor(scratch, OneWord), mload(add(proof, 0xa0)))
      scratch := shl(5, and(shr(6, key), 1))
      mstore(scratch, keccak256(0, TwoWords))
      mstore(xor(scratch, OneWord), mload(add(proof, 0xc0)))
      root := keccak256(0, TwoWords)
    }
    bytes32 rootTypeHash = _BULK_ORDER_TYPEHASH;
    assembly {
      mstore(0, rootTypeHash)
      mstore(0x20, root)
      bulkOrderHash := keccak256(0, 0x40)
    }
  }

  function _verifyOrderStatus(bytes32 orderHash, OrderStatus storage orderStatus, bool onlyAllowUnused, bool revertOnInvalid) internal view returns (bool valid) {
    if (orderStatus.isCancelled) {
      if (revertOnInvalid) {
        _revertOrderIsCancelled(orderHash);
      }
      return false;
    }
    uint256 orderStatusNumerator = orderStatus.numerator;
    if (orderStatusNumerator != 0) {
      if (onlyAllowUnused) {
        _revertOrderPartiallyFilled(orderHash);
      } else if (orderStatusNumerator >= orderStatus.denominator) {
        if (revertOnInvalid) {
          _revertOrderAlreadyFilled(orderHash);
        }
        return false;
      }
    }
    valid = true;
  }
}