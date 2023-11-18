pragma solidity >=0.8.17;

library JsonLib {
  using LibStringPartial for *;
  using JsonLib for *;

  function serializeObject(string[] memory keys, string[] memory values) internal pure returns (string memory output) {
    output = "{";
    uint256 lastIndex = keys.length - 1;
    for (uint256 i = 0; i < lastIndex; i++) {
      serializeKeyValuePair(keys[i], values[i], false);
    }
    output = string.concat(output, "\"", keys[lastIndex], "\":", values[lastIndex], "}");
  }

  function serializeKeyValuePair(string memory key, string memory value, bool isLast) internal pure returns (string memory output) {
    output = string.concat("\"", key, "\":", value);
    if (!isLast) {
      output = string.concat(output, ",");
    }
  }

  function serializeUint(uint256 value) internal pure returns (string memory) {
    if (value > 9007199254740991) {
      return value.toHexString().serializeString();
    }
    return value.toString();
  }

  function serializeInt(int256 value) internal pure returns (string memory) {
    if ((value > 9007199254740991) || (value < (-9007199254740991))) {
      return value.toHexString().serializeString();
    }
    return value.toString();
  }

  function serializeBytes32(bytes32 value) internal pure returns (string memory) {
    return uint256(value).toHexString();
  }

  function serializeBytes(bytes memory value) internal pure returns (string memory) {
    return value.toHexString().serializeString();
  }

  function serializeString(string memory value) internal pure returns (string memory) {
    return string.concat("\"", value, "\"");
  }

  function serializeBool(bool value) internal pure returns (string memory) {
    return value ? "true" : "false";
  }

  function serializeAddress(address value) internal pure returns (string memory) {
    return value.toHexStringChecksumed().serializeString();
  }
}

/// @custom:author Vectorized
/// Partial copy of solady/src/utils/LibString.sol
library LibStringPartial {
  /// @dev The `length` of the output is too small to contain all the hex digits.
  error HexLengthInsufficient();

  /// @dev Returns the base 10 decimal representation of `value`.
  function toString(uint256 value) internal pure returns (string memory str) {
    /// @solidity memory-safe-assembly
    assembly {
      str := add(mload(0x40), 0x80)
      mstore(0x40, add(str, 0x20))
      mstore(str, 0)
      let end := str
      let w := not(0)
      for {
        let temp := value
      } 1 {} {
        str := add(str, w)
        mstore8(str, add(48, mod(temp, 10)))
        temp := div(temp, 10)
        if iszero(temp) {
          break
        }
      }
      let length := sub(end, str)
      /// @dev Returns the base 10 decimal representation of `value`.
      str := sub(str, 0x20)
      mstore(str, length)
    }
  }

  /// @dev Returns the base 10 decimal representation of `value`.
  function toString(int256 value) internal pure returns (string memory str) {
    if (value >= 0) {
      return toString(uint256(value));
    }
    unchecked {
      str = toString(uint256(-value));
    }
    /// @solidity memory-safe-assembly
    assembly {
      let length := mload(str)
      mstore(str, 0x2d)
      str := sub(str, 1)
      mstore(str, add(length, 1))
    }
  }

  /// @dev Returns the hexadecimal representation of `value`,
  /// left-padded to an input length of `length` bytes.
  /// The output is prefixed with "0x" encoded using 2 hexadecimal digits per byte,
  /// giving a total length of `length 2 + 2` bytes.
  /// Reverts if `length` is too small for the output to contain all the digits.
  function toHexString(uint256 value, uint256 length) internal pure returns (string memory str) {
    str = toHexStringNoPrefix(value, length);
    /// @solidity memory-safe-assembly
    assembly {
      let strLength := add(mload(str), 2)
      mstore(str, 0x3078)
      str := sub(str, 2)
      mstore(str, strLength)
    }
  }

  /// @dev Returns the hexadecimal representation of `value`,
  /// left-padded to an input length of `length` bytes.
  /// The output is prefixed with "0x" encoded using 2 hexadecimal digits per byte,
  /// giving a total length of `length 2` bytes.
  /// Reverts if `length` is too small for the output to contain all the digits.
  function toHexStringNoPrefix(uint256 value, uint256 length) internal pure returns (string memory str) {
    /// @solidity memory-safe-assembly
    assembly {
      str := add(mload(0x40), and(add(shl(1, length), 0x42), not(0x1f)))
      mstore(0x40, add(str, 0x20))
      mstore(str, 0)
      let end := str
      mstore(0x0f, 0x30313233343536373839616263646566)
      let start := sub(str, add(length, length))
      let w := not(1)
      let temp := value
      for {} 1 {} {
        str := add(str, w)
        mstore8(add(str, 1), mload(and(temp, 15)))
        mstore8(str, mload(and(shr(4, temp), 15)))
        temp := shr(8, temp)
        if iszero(xor(str, start)) {
          break
        }
      }
      if temp {
        mstore(0x00, 0x2194895a)
        revert(0x1c, 0x04)
      }
      let strLength := sub(end, str)
      str := sub(str, 0x20)
      mstore(str, strLength)
    }
  }

  /// @dev Returns the hexadecimal representation of `value`.
  /// The output is prefixed with "0x" and encoded using 2 hexadecimal digits per byte.
  function toHexString(uint256 value) internal pure returns (string memory str) {
    str = toHexStringNoPrefix(value);
    /// @solidity memory-safe-assembly
    assembly {
      let strLength := add(mload(str), 2)
      mstore(str, 0x3078)
      str := sub(str, 2)
      mstore(str, strLength)
    }
  }

  /// @dev Returns the hexadecimal representation of `value`.
  /// The output is encoded using 2 hexadecimal digits per byte.
  function toHexStringNoPrefix(uint256 value) internal pure returns (string memory str) {
    /// @solidity memory-safe-assembly
    assembly {
      str := add(mload(0x40), 0x80)
      mstore(0x40, add(str, 0x20))
      mstore(str, 0)
      let end := str
      mstore(0x0f, 0x30313233343536373839616263646566)
      let w := not(1)
      for {
        let temp := value
      } 1 {} {
        str := add(str, w)
        mstore8(add(str, 1), mload(and(temp, 15)))
        mstore8(str, mload(and(shr(4, temp), 15)))
        temp := shr(8, temp)
        if iszero(temp) {
          break
        }
      }
      let strLength := sub(end, str)
      str := sub(str, 0x20)
      mstore(str, strLength)
    }
  }

  /// @dev Returns the hexadecimal representation of `value`.
  /// The output is prefixed with "0x" and encoded using 2 hexadecimal digits per byte.
  /// If `value` is negative, the output is additionally prefixed with "-".
  function toHexString(int256 value) internal pure returns (string memory str) {
    if (value >= 0) {
      return toHexString(uint256(value));
    }
    unchecked {
      str = toHexString(uint256(-value));
    }
    /// @solidity memory-safe-assembly
    assembly {
      let length := mload(str)
      mstore(str, 0x2d)
      str := sub(str, 1)
      mstore(str, add(length, 1))
    }
  }

  /// @dev Returns the hexadecimal representation of `value`.
  /// The output is prefixed with "0x", encoded using 2 hexadecimal digits per byte,
  /// and the alphabets are capitalized conditionally according to
  /// https://eips.ethereum.org/EIPS/eip-55
  function toHexStringChecksumed(address value) internal pure returns (string memory str) {
    str = toHexString(value);
    /// @solidity memory-safe-assembly
    assembly {
      let mask := shl(6, div(not(0), 255))
      let o := add(str, 0x22)
      let hashed := and(keccak256(o, 40), mul(34, mask))
      let t := shl(240, 136)
      for {
        let i := 0
      } 1 {} {
        mstore(add(i, i), mul(t, byte(i, hashed)))
        i := add(i, 1)
        if eq(i, 20) {
          break
        }
      }
      mstore(o, xor(mload(o), shr(1, and(mload(0x00), and(mload(o), mask)))))
      o := add(o, 0x20)
      mstore(o, xor(mload(o), shr(1, and(mload(0x20), and(mload(o), mask)))))
    }
  }

  /// @dev Returns the hexadecimal representation of `value`.
  /// The output is prefixed with "0x" and encoded using 2 hexadecimal digits per byte.
  function toHexString(address value) internal pure returns (string memory str) {
    str = toHexStringNoPrefix(value);
    /// @solidity memory-safe-assembly
    assembly {
      let strLength := add(mload(str), 2)
      mstore(str, 0x3078)
      str := sub(str, 2)
      mstore(str, strLength)
    }
  }

  /// @dev Returns the hexadecimal representation of `value`.
  /// The output is encoded using 2 hexadecimal digits per byte.
  function toHexStringNoPrefix(address value) internal pure returns (string memory str) {
    /// @solidity memory-safe-assembly
    assembly {
      str := mload(0x40)
      mstore(0x40, add(str, 0x80))
      mstore(0x0f, 0x30313233343536373839616263646566)
      str := add(str, 2)
      mstore(str, 40)
      let o := add(str, 0x20)
      mstore(add(o, 40), 0)
      value := shl(96, value)
      for {
        let i := 0
      } 1 {} {
        let p := add(o, add(i, i))
        let temp := byte(i, value)
        mstore8(add(p, 1), mload(and(temp, 15)))
        mstore8(p, mload(shr(4, temp)))
        i := add(i, 1)
        if eq(i, 20) {
          break
        }
      }
    }
  }

  /// @dev Returns the hex encoded string from the raw bytes.
  /// The output is encoded using 2 hexadecimal digits per byte.
  function toHexString(bytes memory raw) internal pure returns (string memory str) {
    str = toHexStringNoPrefix(raw);
    /// @solidity memory-safe-assembly
    assembly {
      let strLength := add(mload(str), 2)
      mstore(str, 0x3078)
      str := sub(str, 2)
      mstore(str, strLength)
    }
  }

  /// @dev Returns the hex encoded string from the raw bytes.
  /// The output is encoded using 2 hexadecimal digits per byte.
  function toHexStringNoPrefix(bytes memory raw) internal pure returns (string memory str) {
    /// @solidity memory-safe-assembly
    assembly {
      let length := mload(raw)
      str := add(mload(0x40), 2)
      mstore(str, add(length, length))
      mstore(0x0f, 0x30313233343536373839616263646566)
      let o := add(str, 0x20)
      let end := add(raw, length)
      for {} iszero(eq(raw, end)) {} {
        raw := add(raw, 1)
        mstore8(add(o, 1), mload(and(mload(raw), 15)))
        mstore8(o, mload(and(shr(4, mload(raw)), 15)))
        o := add(o, 2)
      }
      mstore(o, 0)
      mstore(0x40, and(add(o, 31), not(31)))
    }
  }
}