pragma solidity ^0.8.13;
import { ItemType, Side } from "./ConsiderationEnums.sol";
import { OfferItem, ConsiderationItem, OrderParameters, AdvancedOrder, CriteriaResolver } from "./ConsiderationStructs.sol";
import "./ConsiderationErrors.sol";
import { CriteriaResolutionErrors } from "../interfaces/CriteriaResolutionErrors.sol";

contract CriteriaResolution is CriteriaResolutionErrors {

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

  function _isItemWithCriteria(ItemType itemType) internal pure returns (bool withCriteria) {
    assembly {
      withCriteria := gt(itemType, 3)
    }
  }

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