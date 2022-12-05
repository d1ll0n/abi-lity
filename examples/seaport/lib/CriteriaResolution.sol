pragma solidity ^0.8.13;

import { ItemType, Side } from "./ConsiderationEnums.sol";
import { OfferItem, ConsiderationItem, OrderParameters, AdvancedOrder, CriteriaResolver } from "./ConsiderationStructs.sol";
import "./ConsiderationErrors.sol";
import { CriteriaResolutionErrors } from "../interfaces/CriteriaResolutionErrors.sol";

/// @title CriteriaResolution
///   @author 0age
///   @notice CriteriaResolution contains a collection of pure functions related to
///           resolving criteria-based items.
contract CriteriaResolution is CriteriaResolutionErrors {
  /// @dev Internal pure function to apply criteria resolvers containing
  ///        specific token identifiers and associated proofs to order items.
  ///   @param advancedOrders     The orders to apply criteria resolvers to.
  ///   @param criteriaResolvers  An array where each element contains a
  ///                             reference to a specific order as well as that
  ///                             order's offer or consideration, a token
  ///                             identifier, and a proof that the supplied token
  ///                             identifier is contained in the order's merkle
  ///                             root. Note that a root of zero indicates that
  ///                             any transferable token identifier is valid and
  ///                             that no proof needs to be supplied.
  function _applyCriteriaResolvers(AdvancedOrder[] memory advancedOrders, CriteriaResolver[] memory criteriaResolvers) internal pure {
    unchecked {
      uint256 totalCriteriaResolvers = criteriaResolvers.length;
      uint256 totalAdvancedOrders = advancedOrders.length;
      for (uint256 i = 0; i < totalCriteriaResolvers; ++i) {
        CriteriaResolver memory criteriaResolver = (criteriaResolvers[i]);
        uint256 orderIndex = criteriaResolver.orderIndex;
        if (orderIndex >= totalAdvancedOrders) {
          _revertOrderCriteriaResolverOutOfRange();
        }
        if (advancedOrders[orderIndex].numerator == 0) {
          continue;
        }
        OrderParameters memory orderParameters = (advancedOrders[orderIndex].parameters);
        uint256 componentIndex = criteriaResolver.index;
        ItemType itemType;
        uint256 identifierOrCriteria;
        if (criteriaResolver.side == Side.OFFER) {
          OfferItem[] memory offer = orderParameters.offer;
          if (componentIndex >= offer.length) {
            _revertOfferCriteriaResolverOutOfRange();
          }
          OfferItem memory offerItem = offer[componentIndex];
          itemType = offerItem.itemType;
          identifierOrCriteria = offerItem.identifierOrCriteria;
          ItemType newItemType;
          assembly {
            newItemType := sub(3, eq(itemType, 4))
          }
          offerItem.itemType = newItemType;
          offerItem.identifierOrCriteria = criteriaResolver.identifier;
        } else {
          ConsiderationItem[] memory consideration = (orderParameters.consideration);
          if (componentIndex >= consideration.length) {
            _revertConsiderationCriteriaResolverOutOfRange();
          }
          ConsiderationItem memory considerationItem = (consideration[componentIndex]);
          itemType = considerationItem.itemType;
          identifierOrCriteria = (considerationItem.identifierOrCriteria);
          ItemType newItemType;
          assembly {
            newItemType := sub(3, eq(itemType, 4))
          }
          considerationItem.itemType = newItemType;
          considerationItem.identifierOrCriteria = (criteriaResolver.identifier);
        }
        if (!_isItemWithCriteria(itemType)) {
          _revertCriteriaNotEnabledForItem();
        }
        if (identifierOrCriteria != uint256(0)) {
          _verifyProof(criteriaResolver.identifier, identifierOrCriteria, criteriaResolver.criteriaProof);
        }
      }
      for (uint256 i = 0; i < totalAdvancedOrders; ++i) {
        AdvancedOrder memory advancedOrder = advancedOrders[i];
        if (advancedOrder.numerator == 0) {
          continue;
        }
        OrderParameters memory orderParameters = (advancedOrder.parameters);
        uint256 totalItems = orderParameters.consideration.length;
        for (uint256 j = 0; j < totalItems; ++j) {
          if (_isItemWithCriteria(orderParameters.consideration[j].itemType)) {
            _revertUnresolvedConsiderationCriteria();
          }
        }
        totalItems = orderParameters.offer.length;
        for (uint256 j = 0; j < totalItems; ++j) {
          if (_isItemWithCriteria(orderParameters.offer[j].itemType)) {
            _revertUnresolvedOfferCriteria();
          }
        }
      }
    }
  }

  /// @dev Internal pure function to check whether a given item type represents
  ///        a criteria-based ERC721 or ERC1155 item (e.g. an item that can be
  ///        resolved to one of a number of different identifiers at the time of
  ///        order fulfillment).
  ///   @param itemType The item type in question.
  ///   @return withCriteria A boolean indicating that the item type in question
  ///                        represents a criteria-based item.
  function _isItemWithCriteria(ItemType itemType) internal pure returns (bool withCriteria) {
    assembly {
      withCriteria := gt(itemType, 3)
    }
  }

  /// @dev Internal pure function to ensure that a given element is contained
  ///        in a merkle root via a supplied proof.
  ///   @param leaf  The element for which to prove inclusion.
  ///   @param root  The merkle root that inclusion will be proved against.
  ///   @param proof The merkle proof.
  function _verifyProof(uint256 leaf, uint256 root, bytes32[] memory proof) internal pure {
    bool isValid;
    assembly {
      mstore(0, leaf)
      let computedHash := keccak256(0, OneWord)
      let data := add(proof, OneWord)
      for {
        let end := add(data, shl(5, mload(proof)))
      } lt(data, end) {
        data := add(data, OneWord)
      } {
        let loadedData := mload(data)
        let scratch := shl(5, gt(computedHash, loadedData))
        mstore(scratch, computedHash)
        mstore(xor(scratch, OneWord), loadedData)
        computedHash := keccak256(0, TwoWords)
      }
      isValid := eq(computedHash, root)
    }
    if (!isValid) {
      _revertInvalidProof();
    }
  }
}