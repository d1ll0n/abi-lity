type MarketStateCache is uint256;

struct MarketState {
  bool isClosed;
  uint128 maxTotalSupply;
  uint128 accruedProtocolFees;
  uint128 normalizedUnclaimedWithdrawals;
  uint104 scaledTotalSupply;
  uint104 scaledPendingWithdrawals;
  uint32 pendingWithdrawalExpiry;
  bool isDelinquent;
  uint32 timeDelinquent;
  uint16 annualInterestBips;
  uint16 reserveRatioBips;
  uint112 scaleFactor;
  uint32 lastInterestAccruedTimestamp;
}

using LibMarketStateCache for MarketStateCache global;

library LibMarketStateCache {
  function cache(MarketState storage stored) internal returns (MarketStateCache cache) {
    assembly {
      cache := mload(0x40)
      mstore(0x40, add(cache, 32))
      mstore(cache, 0)
      mstore(add(cache, 0x05), sload(stored.slot))
      mstore(add(cache, 0x25), sload(add(stored.slot, 0x01)))
      mstore(add(cache, 0x45), sload(add(stored.slot, 0x02)))
      mstore(add(cache, 0x65), sload(add(stored.slot, 0x03)))
      mstore(add(cache, 0x85), sload(add(stored.slot, 0x04)))
    }
  }

  function getIsclosed(MarketStateCache cache) internal pure returns (bool isClosed) {
    assembly {
      isClosed := byte(5, mload(cache))
    }
  }

  function setIsclosed(MarketStateCache cache, bool isClosed) internal pure {
    assembly {
      mstore8(cache, 1)
      mstore8(add(cache, 0x05), isClosed)
    }
  }

  function getMaxtotalsupply(
    MarketStateCache cache
  ) internal pure returns (uint128 maxTotalSupply) {
    assembly {
      maxTotalSupply := shr(0x80, mload(add(cache, 0x06)))
    }
  }

  function setMaxtotalsupply(MarketStateCache cache, uint128 maxTotalSupply) internal pure {
    assembly {
      mstore8(cache, 1)
      let startPointer := add(cache, 0x06)
      mstore(startPointer, or(shr(0x80, shl(0x80, mload(startPointer))), shl(0x80, maxTotalSupply)))
    }
  }

  function getAccruedprotocolfees(
    MarketStateCache cache
  ) internal pure returns (uint128 accruedProtocolFees) {
    assembly {
      accruedProtocolFees := shr(0x80, mload(add(cache, 0x25)))
    }
  }

  function setAccruedprotocolfees(
    MarketStateCache cache,
    uint128 accruedProtocolFees
  ) internal pure {
    assembly {
      mstore8(add(cache, 0x01), 1)
      let rightAlignedPointer := add(cache, 0x15)
      mstore(
        rightAlignedPointer,
        or(shl(0x80, shr(0x80, mload(rightAlignedPointer))), accruedProtocolFees)
      )
    }
  }

  function getNormalizedunclaimedwithdrawals(
    MarketStateCache cache
  ) internal pure returns (uint128 normalizedUnclaimedWithdrawals) {
    assembly {
      normalizedUnclaimedWithdrawals := shr(0x80, mload(add(cache, 0x45)))
    }
  }

  function setNormalizedunclaimedwithdrawals(
    MarketStateCache cache,
    uint128 normalizedUnclaimedWithdrawals
  ) internal pure {
    assembly {
      mstore8(add(cache, 0x02), 1)
      let rightAlignedPointer := add(cache, 0x35)
      mstore(
        rightAlignedPointer,
        or(shl(0x80, shr(0x80, mload(rightAlignedPointer))), normalizedUnclaimedWithdrawals)
      )
    }
  }

  function getScaledtotalsupply(
    MarketStateCache cache
  ) internal pure returns (uint104 scaledTotalSupply) {
    assembly {
      scaledTotalSupply := shr(0x98, mload(add(cache, 0x55)))
    }
  }

  function setScaledtotalsupply(MarketStateCache cache, uint104 scaledTotalSupply) internal pure {
    assembly {
      mstore8(add(cache, 0x02), 1)
      let rightAlignedPointer := add(cache, 0x42)
      mstore(
        rightAlignedPointer,
        or(shl(0x68, shr(0x68, mload(rightAlignedPointer))), scaledTotalSupply)
      )
    }
  }

  function getScaledpendingwithdrawals(
    MarketStateCache cache
  ) internal pure returns (uint104 scaledPendingWithdrawals) {
    assembly {
      scaledPendingWithdrawals := shr(0x98, mload(add(cache, 0x65)))
    }
  }

  function setScaledpendingwithdrawals(
    MarketStateCache cache,
    uint104 scaledPendingWithdrawals
  ) internal pure {
    assembly {
      mstore8(add(cache, 0x03), 1)
      let rightAlignedPointer := add(cache, 0x52)
      mstore(
        rightAlignedPointer,
        or(shl(0x68, shr(0x68, mload(rightAlignedPointer))), scaledPendingWithdrawals)
      )
    }
  }

  function getPendingwithdrawalexpiry(
    MarketStateCache cache
  ) internal pure returns (uint32 pendingWithdrawalExpiry) {
    assembly {
      pendingWithdrawalExpiry := shr(0xe0, mload(add(cache, 0x72)))
    }
  }

  function setPendingwithdrawalexpiry(
    MarketStateCache cache,
    uint32 pendingWithdrawalExpiry
  ) internal pure {
    assembly {
      mstore8(add(cache, 0x03), 1)
      let rightAlignedPointer := add(cache, 0x56)
      mstore(
        rightAlignedPointer,
        or(shl(0x20, shr(0x20, mload(rightAlignedPointer))), pendingWithdrawalExpiry)
      )
    }
  }

  function getIsdelinquent(MarketStateCache cache) internal pure returns (bool isDelinquent) {
    assembly {
      isDelinquent := and(mload(add(cache, 0x57)), 0xff)
    }
  }

  function setIsdelinquent(MarketStateCache cache, bool isDelinquent) internal pure {
    assembly {
      mstore8(add(cache, 0x03), 1)
      mstore8(add(cache, 0x76), isDelinquent)
    }
  }

  function getTimedelinquent(MarketStateCache cache) internal pure returns (uint32 timeDelinquent) {
    assembly {
      timeDelinquent := shr(0xe0, mload(add(cache, 0x77)))
    }
  }

  function setTimedelinquent(MarketStateCache cache, uint32 timeDelinquent) internal pure {
    assembly {
      mstore8(add(cache, 0x03), 1)
      let rightAlignedPointer := add(cache, 0x5b)
      mstore(
        rightAlignedPointer,
        or(shl(0x20, shr(0x20, mload(rightAlignedPointer))), timeDelinquent)
      )
    }
  }

  function getAnnualinterestbips(
    MarketStateCache cache
  ) internal pure returns (uint16 annualInterestBips) {
    assembly {
      annualInterestBips := shr(0xf0, mload(add(cache, 0x7b)))
    }
  }

  function setAnnualinterestbips(MarketStateCache cache, uint16 annualInterestBips) internal pure {
    assembly {
      mstore8(add(cache, 0x03), 1)
      let rightAlignedPointer := add(cache, 0x5d)
      mstore(
        rightAlignedPointer,
        or(shl(0x10, shr(0x10, mload(rightAlignedPointer))), annualInterestBips)
      )
    }
  }

  function getReserveratiobips(
    MarketStateCache cache
  ) internal pure returns (uint16 reserveRatioBips) {
    assembly {
      reserveRatioBips := shr(0xf0, mload(add(cache, 0x7d)))
    }
  }

  function setReserveratiobips(MarketStateCache cache, uint16 reserveRatioBips) internal pure {
    assembly {
      mstore8(add(cache, 0x03), 1)
      let rightAlignedPointer := add(cache, 0x5f)
      mstore(
        rightAlignedPointer,
        or(shl(0x10, shr(0x10, mload(rightAlignedPointer))), reserveRatioBips)
      )
    }
  }

  function getScalefactor(MarketStateCache cache) internal pure returns (uint112 scaleFactor) {
    assembly {
      scaleFactor := shr(0x90, mload(add(cache, 0x85)))
    }
  }

  function setScalefactor(MarketStateCache cache, uint112 scaleFactor) internal pure {
    assembly {
      mstore8(add(cache, 0x04), 1)
      let rightAlignedPointer := add(cache, 0x73)
      mstore(rightAlignedPointer, or(shl(0x70, shr(0x70, mload(rightAlignedPointer))), scaleFactor))
    }
  }

  function getLastinterestaccruedtimestamp(
    MarketStateCache cache
  ) internal pure returns (uint32 lastInterestAccruedTimestamp) {
    assembly {
      lastInterestAccruedTimestamp := shr(0xe0, mload(add(cache, 0x93)))
    }
  }

  function setLastinterestaccruedtimestamp(
    MarketStateCache cache,
    uint32 lastInterestAccruedTimestamp
  ) internal pure {
    assembly {
      mstore8(add(cache, 0x04), 1)
      let rightAlignedPointer := add(cache, 0x77)
      mstore(
        rightAlignedPointer,
        or(shl(0x20, shr(0x20, mload(rightAlignedPointer))), lastInterestAccruedTimestamp)
      )
    }
  }

  function update(MarketState storage stored, MarketStateCache cache) internal {
    assembly {
      let flags := mload(cache)
      if byte(0, flags) {
        sstore(stored.slot, mload(add(cache, 0x05)))
      }
      if byte(1, flags) {
        sstore(add(stored.slot, 0x01), mload(add(cache, 0x25)))
      }
      if byte(2, flags) {
        sstore(add(stored.slot, 0x02), mload(add(cache, 0x45)))
      }
      if byte(3, flags) {
        sstore(add(stored.slot, 0x03), mload(add(cache, 0x65)))
      }
      if byte(4, flags) {
        sstore(add(stored.slot, 0x04), mload(add(cache, 0x85)))
      }
      calldatacopy(cache, calldatasize(), 5)
    }
  }
}
