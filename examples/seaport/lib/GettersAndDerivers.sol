pragma solidity ^0.8.13;

import { OrderParameters } from "./ConsiderationStructs.sol";
import { ConsiderationBase } from "./ConsiderationBase.sol";
import "./ConsiderationConstants.sol";

///  @title GettersAndDerivers
///  @author 0age
///  @notice ConsiderationInternal contains pure and internal view functions
///          related to getting or deriving various values.
contract GettersAndDerivers is ConsiderationBase {
  ///  @dev Derive and set hashes, reference chainId, and associated domain
  ///       separator during deployment.
  ///  @param conduitController A contract that deploys conduits, or proxies
  ///                           that may optionally be used to transfer approved
  ///                           ERC20/721/1155 tokens.
  constructor(address conduitController) ConsiderationBase(conduitController) {}

  ///  @dev Internal view function to derive the order hash for a given order.
  ///       Note that only the original consideration items are included in the
  ///       order hash, as additional consideration items may be supplied by the
  ///       caller.
  ///  @param orderParameters The parameters of the order to hash.
  ///  @param counter           The counter of the order to hash.
  ///  @return orderHash The hash.
  function _deriveOrderHash(OrderParameters memory orderParameters, uint256 counter) internal view returns (bytes32 orderHash) {
    uint256 originalConsiderationLength = (orderParameters.totalOriginalConsiderationItems);
    bytes32 offerHash;
    bytes32 typeHash = _OFFER_ITEM_TYPEHASH;
    assembly {
      let hashArrPtr := mload(FreeMemoryPointerSlot)
      let offerArrPtr := mload(add(orderParameters, OrderParameters_offer_head_offset))
      let offerLength := mload(offerArrPtr)
      offerArrPtr := add(offerArrPtr, OneWord)
      for {
        let i := 0
      } lt(i, offerLength) {
        i := add(i, 1)
      } {
        let ptr := sub(mload(offerArrPtr), OneWord)
        let value := mload(ptr)
        mstore(ptr, typeHash)
        mstore(hashArrPtr, keccak256(ptr, EIP712_OfferItem_size))
        mstore(ptr, value)
        offerArrPtr := add(offerArrPtr, OneWord)
        hashArrPtr := add(hashArrPtr, OneWord)
      }
      offerHash := keccak256(mload(FreeMemoryPointerSlot), mul(offerLength, OneWord))
    }
    bytes32 considerationHash;
    typeHash = _CONSIDERATION_ITEM_TYPEHASH;
    assembly {
      let hashArrPtr := mload(FreeMemoryPointerSlot)
      let considerationArrPtr := add(mload(add(orderParameters, OrderParameters_consideration_head_offset)), OneWord)
      for {
        let i := 0
      } lt(i, originalConsiderationLength) {
        i := add(i, 1)
      } {
        let ptr := sub(mload(considerationArrPtr), OneWord)
        let value := mload(ptr)
        mstore(ptr, typeHash)
        mstore(hashArrPtr, keccak256(ptr, EIP712_ConsiderationItem_size))
        mstore(ptr, value)
        considerationArrPtr := add(considerationArrPtr, OneWord)
        hashArrPtr := add(hashArrPtr, OneWord)
      }
      considerationHash := keccak256(mload(FreeMemoryPointerSlot), mul(originalConsiderationLength, OneWord))
    }
    typeHash = _ORDER_TYPEHASH;
    assembly {
      let typeHashPtr := sub(orderParameters, OneWord)
      let previousValue := mload(typeHashPtr)
      mstore(typeHashPtr, typeHash)
      let offerHeadPtr := add(orderParameters, OrderParameters_offer_head_offset)
      let offerDataPtr := mload(offerHeadPtr)
      mstore(offerHeadPtr, offerHash)
      let considerationHeadPtr := add(orderParameters, OrderParameters_consideration_head_offset)
      let considerationDataPtr := mload(considerationHeadPtr)
      mstore(considerationHeadPtr, considerationHash)
      let counterPtr := add(orderParameters, OrderParameters_counter_offset)
      mstore(counterPtr, counter)
      orderHash := keccak256(typeHashPtr, EIP712_Order_size)
      mstore(typeHashPtr, previousValue)
      mstore(offerHeadPtr, offerDataPtr)
      mstore(considerationHeadPtr, considerationDataPtr)
      mstore(counterPtr, originalConsiderationLength)
    }
  }

  ///  @dev Internal view function to derive the address of a given conduit
  ///       using a corresponding conduit key.
  ///  @param conduitKey A bytes32 value indicating what corresponding conduit,
  ///                    if any, to source token approvals from. This value is
  ///                    the "salt" parameter supplied by the deployer (i.e. the
  ///                    conduit controller) when deploying the given conduit.
  ///  @return conduit The address of the conduit associated with the given
  ///                  conduit key.
  function _deriveConduit(bytes32 conduitKey) internal view returns (address conduit) {
    address conduitController = address(_CONDUIT_CONTROLLER);
    bytes32 conduitCreationCodeHash = _CONDUIT_CREATION_CODE_HASH;
    assembly {
      let freeMemoryPointer := mload(FreeMemoryPointerSlot)
      mstore(0, or(MaskOverByteTwelve, conduitController))
      mstore(OneWord, conduitKey)
      mstore(TwoWords, conduitCreationCodeHash)
      conduit := and(keccak256(Create2AddressDerivation_ptr, Create2AddressDerivation_length), MaskOverLastTwentyBytes)
      mstore(FreeMemoryPointerSlot, freeMemoryPointer)
    }
  }

  ///  @dev Internal view function to get the EIP-712 domain separator. If the
  ///       chainId matches the chainId set on deployment, the cached domain
  ///       separator will be returned; otherwise, it will be derived from
  ///       scratch.
  ///  @return The domain separator.
  function _domainSeparator() internal view returns (bytes32) {
    return (block.chainid == _CHAIN_ID) ? _DOMAIN_SEPARATOR : _deriveDomainSeparator();
  }

  ///  @dev Internal view function to retrieve configuration information for
  ///       this contract.
  ///  @return The contract version.
  ///  @return The domain separator for this contract.
  ///  @return The conduit Controller set for this contract.
  function _information() internal view returns (string memory, bytes32, address) {
    bytes32 domainSeparator = _domainSeparator();
    address conduitController = address(_CONDUIT_CONTROLLER);
    assembly {
      mstore(information_version_offset, information_version_cd_offset)
      mstore(information_domainSeparator_offset, domainSeparator)
      mstore(information_conduitController_offset, conduitController)
      mstore(information_versionLengthPtr, information_versionWithLength)
      return(information_version_offset, information_length)
    }
  }

  ///  @dev Internal pure function to efficiently derive an digest to sign for
  ///       an order in accordance with EIP-712.
  ///  @param domainSeparator The domain separator.
  ///  @param orderHash       The order hash.
  ///  @return value The hash.
  function _deriveEIP712Digest(bytes32 domainSeparator, bytes32 orderHash) internal pure returns (bytes32 value) {
    assembly {
      mstore(0, EIP_712_PREFIX)
      mstore(EIP712_DomainSeparator_offset, domainSeparator)
      mstore(EIP712_OrderHash_offset, orderHash)
      value := keccak256(0, EIP712_DigestPayload_size)
      mstore(EIP712_OrderHash_offset, 0)
    }
  }
}