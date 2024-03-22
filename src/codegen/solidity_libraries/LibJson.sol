pragma solidity >=0.8.17;

library LibJson {
  using LibJson for *;
  using LibStringStub for *;

  using LibJson for address;
  using LibJson for uint256;
  using LibJson for uint256[];

  // StringLiteral internal constant Comma = StringLiteral.wrap(0x012c000000000000000000000000000000000000000000000000000000000000);
  // StringLiteral internal constant Colon = StringLiteral.wrap(0x013a000000000000000000000000000000000000000000000000000000000000);
  // StringLiteral internal constant Quote = StringLiteral.wrap(0x0122000000000000000000000000000000000000000000000000000000000000);

  function serializeArray(
    uint256[] memory arr,
    function(uint256 /* element */) pure returns (string memory) serializeElement
  ) internal pure returns (string memory output) {
    output = "[";
    uint256 lastIndex = arr.length - 1;
    for (uint256 i = 0; i < lastIndex; i++) {
      output = string.concat(output, serializeElement(arr[i]), ",");
    }
    output = string.concat(output, serializeElement(arr[lastIndex]), "]");
  }

  function serializeObject(
    string[] memory keys,
    string[] memory values
  ) internal pure returns (string memory output) {
    output = "{";
    uint256 lastIndex = keys.length - 1;
    for (uint256 i = 0; i < lastIndex; i++) {
      output = string.concat(output, '"', keys[i], '": ', values[i], ",");
    }
    output = string.concat(output, '"', keys[lastIndex], '":', values[lastIndex], "}");
  }

  function serializeUint256(uint256 value) internal pure returns (string memory) {
    // Max safe number in JS
    if (value > 9007199254740991) {
      return value.toHexString().serializeString();
    }
    return value.toString();
  }

  function serializeInt256(int256 value) internal pure returns (string memory) {
    // Min/max safe numbers in JS
    if (value > 9007199254740991 || value < -9007199254740991) {
      return value.toHexString().serializeString();
    }
    return value.toString();
  }

  function serializeBytes32(bytes32 value) internal pure returns (string memory) {
    return uint256(value).toHexString().serializeString();
  }

  function serializeBytes(bytes memory value) internal pure returns (string memory) {
    return value.toHexString().serializeString();
  }

  function serializeString(string memory value) internal pure returns (string memory) {
    return string.concat('"', value, '"');
  }

  function serializeBool(bool value) internal pure returns (string memory) {
    return value ? "true" : "false";
  }

  function serializeAddress(address value) internal pure returns (string memory) {
    return value.toHexString().serializeString();
  }

  function toHexString(int256 value) internal pure returns (string memory str) {
    if (value >= 0) {
      return uint256(value).toHexString();
    }
    unchecked {
      str = uint256(-value).toHexString();
    }
    /// @solidity memory-safe-assembly
    assembly {
      // We still have some spare memory space on the left,
      // as we have allocated 3 words (96 bytes) for up to 78 digits.
      let length := mload(str) // Load the string length.
      mstore(str, 0x2d) // Store the '-' character.
      str := sub(str, 1) // Move back the string pointer by a byte.
      mstore(str, add(length, 1)) // Update the string length.
    }
  }

  function serializeBoolArray(bool[] memory arr) internal pure returns (string memory) {
    function(uint256[] memory, function(uint256) pure returns (string memory))
      internal
      pure
      returns (string memory) _fn = serializeArray;
    function(bool[] memory, function(bool) pure returns (string memory))
      internal
      pure
      returns (string memory) fn;
    assembly {
      fn := _fn
    }
    return fn(arr, serializeBool);
  }

  function serializeUint256Array(uint256[] memory arr) internal pure returns (string memory) {
    return serializeArray(arr, serializeUint256);
  }

  function serializeInt256Array(int256[] memory arr) internal pure returns (string memory) {
    function(uint256[] memory, function(uint256) pure returns (string memory))
      internal
      pure
      returns (string memory) _fn = serializeArray;
    function(int256[] memory, function(int256) pure returns (string memory))
      internal
      pure
      returns (string memory) fn;
    assembly {
      fn := _fn
    }
    return fn(arr, serializeInt256);
  }

  function serializeAddressArray(address[] memory arr) internal pure returns (string memory) {
    function(uint256[] memory, function(uint256) pure returns (string memory))
      internal
      pure
      returns (string memory) _fn = serializeArray;
    function(address[] memory, function(address) pure returns (string memory))
      internal
      pure
      returns (string memory) fn;
    assembly {
      fn := _fn
    }
    return fn(arr, serializeAddress);
  }

  function serializeBytes32Array(bytes32[] memory arr) internal pure returns (string memory) {
    function(uint256[] memory, function(uint256) pure returns (string memory))
      internal
      pure
      returns (string memory) _fn = serializeArray;
    function(bytes32[] memory, function(bytes32) pure returns (string memory))
      internal
      pure
      returns (string memory) fn;
    assembly {
      fn := _fn
    }
    return fn(arr, serializeBytes32);
  }

  function serializeStringArray(string[] memory arr) internal pure returns (string memory) {
    function(uint256[] memory, function(uint256) pure returns (string memory))
      internal
      pure
      returns (string memory) _fn = serializeArray;
    function(string[] memory, function(string memory) pure returns (string memory))
      internal
      pure
      returns (string memory) fn;
    assembly {
      fn := _fn
    }
    return fn(arr, serializeString);
  }
}

library LibStringStub {
  /// @dev Returns the base 10 decimal representation of `value`.
  function toString(uint256 value) internal pure returns (string memory str) {
    /// @solidity memory-safe-assembly
    assembly {
      // The maximum value of a uint256 contains 78 digits (1 byte per digit), but
      // we allocate 0xa0 bytes to keep the free memory pointer 32-byte word aligned.
      // We will need 1 word for the trailing zeros padding, 1 word for the length,
      // and 3 words for a maximum of 78 digits.
      str := add(mload(0x40), 0x80)
      // Update the free memory pointer to allocate.
      mstore(0x40, add(str, 0x20))
      // Zeroize the slot after the string.
      mstore(str, 0)

      // Cache the end of the memory to calculate the length later.
      let end := str

      let w := not(0) // Tsk.
      // We write the string from rightmost digit to leftmost digit.
      // The following is essentially a do-while loop that also handles the zero case.
      for {
        let temp := value
      } 1 {

      } {
        str := add(str, w) // `sub(str, 1)`.
        // Write the character to the pointer.
        // The ASCII index of the '0' character is 48.
        mstore8(str, add(48, mod(temp, 10)))
        // Keep dividing `temp` until zero.
        temp := div(temp, 10)
        if iszero(temp) {
          break
        }
      }

      let length := sub(end, str)
      // Move the pointer 32 bytes leftwards to make room for the length.
      str := sub(str, 0x20)
      // Store the length.
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
      // We still have some spare memory space on the left,
      // as we have allocated 3 words (96 bytes) for up to 78 digits.
      let length := mload(str) // Load the string length.
      mstore(str, 0x2d) // Store the '-' character.
      str := sub(str, 1) // Move back the string pointer by a byte.
      mstore(str, add(length, 1)) // Update the string length.
    }
  }

  /// @dev Returns the hexadecimal representation of `value`.
  /// The output is prefixed with "0x" and encoded using 2 hexadecimal digits per byte.
  /// As address are 20 bytes long, the output will left-padded to have
  /// a length of `20 * 2 + 2` bytes.
  function toHexString(uint256 value) internal pure returns (string memory str) {
    str = toHexStringNoPrefix(value);
    /// @solidity memory-safe-assembly
    assembly {
      let strLength := add(mload(str), 2) // Compute the length.
      mstore(str, 0x3078) // Write the "0x" prefix.
      str := sub(str, 2) // Move the pointer.
      mstore(str, strLength) // Write the length.
    }
  }

  /// @dev Returns the hexadecimal representation of `value`.
  /// The output is encoded using 2 hexadecimal digits per byte.
  /// As address are 20 bytes long, the output will left-padded to have
  /// a length of `20 * 2` bytes.
  function toHexStringNoPrefix(uint256 value) internal pure returns (string memory str) {
    /// @solidity memory-safe-assembly
    assembly {
      // We need 0x20 bytes for the trailing zeros padding, 0x20 bytes for the length,
      // 0x02 bytes for the prefix, and 0x40 bytes for the digits.
      // The next multiple of 0x20 above (0x20 + 0x20 + 0x02 + 0x40) is 0xa0.
      str := add(mload(0x40), 0x80)
      // Allocate the memory.
      mstore(0x40, add(str, 0x20))
      // Zeroize the slot after the string.
      mstore(str, 0)

      // Cache the end to calculate the length later.
      let end := str
      // Store "0123456789abcdef" in scratch space.
      mstore(0x0f, 0x30313233343536373839616263646566)

      let w := not(1) // Tsk.
      // We write the string from rightmost digit to leftmost digit.
      // The following is essentially a do-while loop that also handles the zero case.
      for {
        let temp := value
      } 1 {

      } {
        str := add(str, w) // `sub(str, 2)`.
        mstore8(add(str, 1), mload(and(temp, 15)))
        mstore8(str, mload(and(shr(4, temp), 15)))
        temp := shr(8, temp)
        if iszero(temp) {
          break
        }
      }

      // Compute the string's length.
      let strLength := sub(end, str)
      // Move the pointer and write the length.
      str := sub(str, 0x20)
      mstore(str, strLength)
    }
  }

  /// @dev Returns the hexadecimal representation of `value`.
  /// The output is prefixed with "0x" and encoded using 2 hexadecimal digits per byte.
  function toHexString(address value) internal pure returns (string memory str) {
    str = toHexStringNoPrefix(value);
    /// @solidity memory-safe-assembly
    assembly {
      let strLength := add(mload(str), 2) // Compute the length.
      mstore(str, 0x3078) // Write the "0x" prefix.
      str := sub(str, 2) // Move the pointer.
      mstore(str, strLength) // Write the length.
    }
  }

  /// @dev Returns the hexadecimal representation of `value`.
  /// The output is encoded using 2 hexadecimal digits per byte.
  function toHexStringNoPrefix(address value) internal pure returns (string memory str) {
    /// @solidity memory-safe-assembly
    assembly {
      str := mload(0x40)

      // Allocate the memory.
      // We need 0x20 bytes for the trailing zeros padding, 0x20 bytes for the length,
      // 0x02 bytes for the prefix, and 0x28 bytes for the digits.
      // The next multiple of 0x20 above (0x20 + 0x20 + 0x02 + 0x28) is 0x80.
      mstore(0x40, add(str, 0x80))

      // Store "0123456789abcdef" in scratch space.
      mstore(0x0f, 0x30313233343536373839616263646566)

      str := add(str, 2)
      mstore(str, 40)

      let o := add(str, 0x20)
      mstore(add(o, 40), 0)

      value := shl(96, value)

      // We write the string from rightmost digit to leftmost digit.
      // The following is essentially a do-while loop that also handles the zero case.
      for {
        let i := 0
      } 1 {

      } {
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
      let strLength := add(mload(str), 2) // Compute the length.
      mstore(str, 0x3078) // Write the "0x" prefix.
      str := sub(str, 2) // Move the pointer.
      mstore(str, strLength) // Write the length.
    }
  }

  /// @dev Returns the hex encoded string from the raw bytes.
  /// The output is encoded using 2 hexadecimal digits per byte.
  function toHexStringNoPrefix(bytes memory raw) internal pure returns (string memory str) {
    /// @solidity memory-safe-assembly
    assembly {
      let length := mload(raw)
      str := add(mload(0x40), 2) // Skip 2 bytes for the optional prefix.
      mstore(str, add(length, length)) // Store the length of the output.

      // Store "0123456789abcdef" in scratch space.
      mstore(0x0f, 0x30313233343536373839616263646566)

      let o := add(str, 0x20)
      let end := add(raw, length)

      for {

      } iszero(eq(raw, end)) {

      } {
        raw := add(raw, 1)
        mstore8(add(o, 1), mload(and(mload(raw), 15)))
        mstore8(o, mload(and(shr(4, mload(raw)), 15)))
        o := add(o, 2)
      }
      mstore(o, 0) // Zeroize the slot after the string.
      mstore(0x40, and(add(o, 31), not(31))) // Allocate the memory.
    }
  }
}
