pragma solidity ^0.8.13;
import { OrderType, ItemType } from "./ConsiderationEnums.sol";
import { OrderParameters, Order, AdvancedOrder, OrderComponents, OrderStatus, CriteriaResolver, OfferItem, ConsiderationItem, SpentItem, ReceivedItem } from "./ConsiderationStructs.sol";
import "./ConsiderationErrors.sol";
import { Executor } from "./Executor.sol";
import { ZoneInteraction } from "./ZoneInteraction.sol";
import { ContractOffererInterface } from "../interfaces/ContractOffererInterface.sol";

contract OrderValidator is Executor, ZoneInteraction {
  mapping(bytes32 => OrderStatus) private _orderStatus;
  mapping(address => uint256) internal _contractNonces;

  constructor(address conduitController) Executor(conduitController) {}

  function _validateBasicOrderAndUpdateStatus(bytes32 orderHash, address offerer, bytes memory signature) internal {
    OrderStatus storage orderStatus = _orderStatus[orderHash];
    _verifyOrderStatus(orderHash, orderStatus, true, true);
    if (!orderStatus.isValidated) {
      _verifySignature(offerer, orderHash, signature);
    }
    orderStatus.isValidated = true;
    orderStatus.isCancelled = false;
    orderStatus.numerator = 1;
    orderStatus.denominator = 1;
  }

  function _validateOrderAndUpdateStatus(AdvancedOrder memory advancedOrder, bool revertOnInvalid) internal returns (bytes32 orderHash, uint256 newNumerator, uint256 newDenominator) {
    OrderParameters memory orderParameters = advancedOrder.parameters;
    if (!_verifyTime(orderParameters.startTime, orderParameters.endTime, revertOnInvalid)) {
      return (bytes32(0), 0, 0);
    }
    if (orderParameters.orderType == OrderType.CONTRACT) {
      return _getGeneratedOrder(orderParameters, advancedOrder.extraData, revertOnInvalid);
    }
    uint256 numerator = uint256(advancedOrder.numerator);
    uint256 denominator = uint256(advancedOrder.denominator);
    if ((numerator > denominator) || (numerator == 0)) {
      _revertBadFraction();
    }
    if ((numerator < denominator) && _doesNotSupportPartialFills(orderParameters.orderType)) {
      _revertPartialFillsNotEnabledForOrder();
    }
    orderHash = _assertConsiderationLengthAndGetOrderHash(orderParameters);
    OrderStatus storage orderStatus = _orderStatus[orderHash];
    if (!_verifyOrderStatus(orderHash, orderStatus, false, revertOnInvalid)) {
      return (orderHash, 0, 0);
    }
    if (!orderStatus.isValidated) {
      _verifySignature(orderParameters.offerer, orderHash, advancedOrder.signature);
    }
    uint256 filledNumerator = orderStatus.numerator;
    uint256 filledDenominator = orderStatus.denominator;
    if (filledDenominator != 0) {
      if (denominator == 1) {
        numerator = filledDenominator;
        denominator = filledDenominator;
      } else if (filledDenominator != denominator) {
        filledNumerator *= denominator;
        numerator *= filledDenominator;
        denominator *= filledDenominator;
      }
      if ((filledNumerator + numerator) > denominator) {
        unchecked {
          numerator = denominator - filledNumerator;
        }
      }
      filledNumerator += numerator;
      assembly {
        if or(gt(filledNumerator, MaxUint120), gt(denominator, MaxUint120)) {
          function gcd (_a, _b) -> out {
            for {} _b {} {
              let _c := _b
              _b := mod(_a, _c)
              _a := _c
            }
            out := _a
          }
          let scaleDown := gcd(numerator, gcd(filledNumerator, denominator))
          let safeScaleDown := add(scaleDown, iszero(scaleDown))
          numerator := div(numerator, safeScaleDown)
          filledNumerator := div(filledNumerator, safeScaleDown)
          denominator := div(denominator, safeScaleDown)
          if or(gt(filledNumerator, MaxUint120), gt(denominator, MaxUint120)) {
            mstore(0, Panic_error_selector)
            mstore(Panic_error_code_ptr, Panic_arithmetic)
            revert(0x1c, Panic_error_length)
          }
        }
      }
      unchecked {
        orderStatus.isValidated = true;
        orderStatus.isCancelled = false;
        orderStatus.numerator = uint120(filledNumerator);
        orderStatus.denominator = uint120(denominator);
      }
    } else {
      orderStatus.isValidated = true;
      orderStatus.isCancelled = false;
      orderStatus.numerator = uint120(numerator);
      orderStatus.denominator = uint120(denominator);
    }
    return (orderHash, numerator, denominator);
  }
  function _getGeneratedOrder(OrderParameters memory orderParameters, bytes memory context, bool revertOnInvalid) internal returns (bytes32 orderHash, uint256 numerator, uint256 denominator) {
    SpentItem[] memory offer;
    ReceivedItem[] memory consideration;
    address offerer = orderParameters.offerer;
    {
      uint256 contractNonce;
      unchecked {
        contractNonce = _contractNonces[offerer]++;
      }
      assembly {
        orderHash := or(contractNonce, shl(0x60, offerer))
      }
    }
    {
      (SpentItem[] memory originalOfferItems, SpentItem[] memory originalConsiderationItems) = _convertToSpent(orderParameters.offer, orderParameters.consideration);
      try ContractOffererInterface(offerer).generateOrder(msg.sender, originalOfferItems, originalConsiderationItems, context) returns (SpentItem[] memory returnedOffer, ReceivedItem[] memory ReturnedConsideration) {
        offer = returnedOffer;
        consideration = ReturnedConsideration;
      } catch (bytes memory) {
        return _revertOrReturnEmpty(revertOnInvalid, orderHash);
      }
    }
    uint256 errorBuffer = 0;
    {
      uint256 originalOfferLength = orderParameters.offer.length;
      uint256 newOfferLength = offer.length;
      if (originalOfferLength > newOfferLength) {
        return _revertOrReturnEmpty(revertOnInvalid, orderHash);
      } else if (newOfferLength > originalOfferLength) {
        OfferItem[] memory extendedOffer = new OfferItem[](newOfferLength);
        for (uint256 i = 0; i < originalOfferLength; ++i) {
          extendedOffer[i] = orderParameters.offer[i];
        }
        orderParameters.offer = extendedOffer;
      }
      for (uint256 i = 0; i < originalOfferLength; ++i) {
        OfferItem memory originalOffer = orderParameters.offer[i];
        SpentItem memory newOffer = offer[i];
        errorBuffer = _check(originalOffer, newOffer, originalOffer.endAmount, newOffer.amount, errorBuffer);
      }
      for (uint256 i = originalOfferLength; i < newOfferLength; ++i) {
        OfferItem memory originalOffer = orderParameters.offer[i];
        SpentItem memory newOffer = offer[i];
        originalOffer.itemType = newOffer.itemType;
        originalOffer.token = newOffer.token;
        originalOffer.identifierOrCriteria = newOffer.identifier;
        originalOffer.startAmount = newOffer.amount;
        originalOffer.endAmount = newOffer.amount;
      }
    }
    {
      function(ConsiderationItem memory, ReceivedItem memory, uint256, uint256, uint256) internal pure returns (uint256) _checkConsideration;
      {
        function(OfferItem memory, SpentItem memory, uint256, uint256, uint256) internal pure returns (uint256) _checkOffer = _check;
        assembly {
          _checkConsideration := _checkOffer
        }
      }
      ConsiderationItem[] memory originalConsiderationArray = (orderParameters.consideration);
      uint256 originalConsiderationLength = originalConsiderationArray.length;
      uint256 newConsiderationLength = consideration.length;
      if (originalConsiderationLength != 0) {
        if (newConsiderationLength > originalConsiderationLength) {
          return _revertOrReturnEmpty(revertOnInvalid, orderHash);
        }
        for (uint256 i = 0; i < newConsiderationLength; ++i) {
          ReceivedItem memory newConsideration = consideration[i];
          ConsiderationItem memory originalConsideration = (originalConsiderationArray[i]);
          errorBuffer = _checkConsideration(originalConsideration, newConsideration, newConsideration.amount, originalConsideration.endAmount, errorBuffer);
          originalConsideration.recipient = newConsideration.recipient;
        }
        assembly {
          mstore(originalConsiderationArray, newConsiderationLength)
        }
      } else {
        orderParameters.consideration = new ConsiderationItem[](newConsiderationLength);
        for (uint256 i = 0; i < newConsiderationLength; ++i) {
          ConsiderationItem memory originalConsideration = (orderParameters.consideration[i]);
          originalConsideration.itemType = consideration[i].itemType;
          originalConsideration.token = consideration[i].token;
          originalConsideration.identifierOrCriteria = consideration[i].identifier;
          originalConsideration.startAmount = consideration[i].amount;
          originalConsideration.endAmount = consideration[i].amount;
          originalConsideration.recipient = consideration[i].recipient;
        }
      }
    }
    if (errorBuffer != 0) {
      return _revertOrReturnEmpty(revertOnInvalid, orderHash);
    }
    return (orderHash, 1, 1);
  }

  function _cancel(OrderComponents[] calldata orders) internal returns (bool cancelled) {
    _assertNonReentrant();
    OrderStatus storage orderStatus;
    address offerer;
    address zone;
    unchecked {
      uint256 totalOrders = orders.length;
      for (uint256 i = 0; i < totalOrders; ) {
        OrderComponents calldata order = orders[i];
        offerer = order.offerer;
        zone = order.zone;
        if ((!_unmaskedAddressComparison(msg.sender, offerer)) && (!_unmaskedAddressComparison(msg.sender, zone))) {
          _revertInvalidCanceller();
        }
        bytes32 orderHash = _deriveOrderHash(OrderParameters(offerer, zone, order.offer, order.consideration, order.orderType, order.startTime, order.endTime, order.zoneHash, order.salt, order.conduitKey, order.consideration.length), order.counter);
        orderStatus = _orderStatus[orderHash];
        orderStatus.isValidated = false;
        orderStatus.isCancelled = true;
        emit OrderCancelled(orderHash, offerer, zone);
        ++i;
      }
    }
    cancelled = true;
  }

  function _validate(Order[] calldata orders) internal returns (bool validated) {
    _assertNonReentrant();
    OrderStatus storage orderStatus;
    bytes32 orderHash;
    address offerer;
    unchecked {
      uint256 totalOrders = orders.length;
      for (uint256 i = 0; i < totalOrders; ) {
        Order calldata order = orders[i];
        OrderParameters calldata orderParameters = order.parameters;
        offerer = orderParameters.offerer;
        orderHash = _assertConsiderationLengthAndGetOrderHash(orderParameters);
        orderStatus = _orderStatus[orderHash];
        _verifyOrderStatus(orderHash, orderStatus, false, true);
        if (!orderStatus.isValidated) {
          _verifySignature(offerer, orderHash, order.signature);
          orderStatus.isValidated = true;
          emit OrderValidated(orderHash, offerer, orderParameters.zone);
        }
        ++i;
      }
    }
    validated = true;
  }

  function _getOrderStatus(bytes32 orderHash) internal view returns (bool isValidated, bool isCancelled, uint256 totalFilled, uint256 totalSize) {
    OrderStatus storage orderStatus = _orderStatus[orderHash];
    return (orderStatus.isValidated, orderStatus.isCancelled, orderStatus.numerator, orderStatus.denominator);
  }
  function _check(OfferItem memory originalOffer, SpentItem memory newOffer, uint256 valueOne, uint256 valueTwo, uint256 errorBuffer) internal pure returns (uint256 updatedErrorBuffer) {
    if ((_cast(uint256(originalOffer.itemType) > 3) & _cast(originalOffer.identifierOrCriteria == 0)) != 0) {
      originalOffer.itemType = _replaceCriteriaItemType(originalOffer.itemType);
      originalOffer.identifierOrCriteria = newOffer.identifier;
    }
    updatedErrorBuffer = ((((errorBuffer | _cast(originalOffer.startAmount != originalOffer.endAmount)) | _cast(valueOne > valueTwo)) | _cast(originalOffer.itemType != newOffer.itemType)) | _cast(originalOffer.token != newOffer.token)) | _cast(originalOffer.identifierOrCriteria != newOffer.identifier);
    originalOffer.startAmount = newOffer.amount;
    originalOffer.endAmount = newOffer.amount;
  }
  function _cast(bool b) internal pure returns (uint256 u) {
    assembly {
      u := b
    }
  }
  function _revertOrReturnEmpty(bool revertOnInvalid, bytes32 contractOrderHash) internal pure returns (bytes32 orderHash, uint256 numerator, uint256 denominator) {
    if (!revertOnInvalid) {
      return (contractOrderHash, 0, 0);
    }
    _revertInvalidContractOrder(contractOrderHash);
  }
  function _replaceCriteriaItemType(ItemType originalItemType) internal pure returns (ItemType newItemType) {
    assembly {
      newItemType := sub(3, eq(originalItemType, 4))
    }
  }

  function _convertToSpent(OfferItem[] memory offer, ConsiderationItem[] memory consideration) internal pure returns (SpentItem[] memory spentItems, SpentItem[] memory receivedItems) {
    assembly {
      spentItems := offer
      receivedItems := consideration
    }
  }

  function _doesNotSupportPartialFills(OrderType orderType) internal pure returns (bool isFullOrder) {
    assembly {
      isFullOrder := iszero(and(orderType, 1))
    }
  }
}