pragma solidity ^0.8.23;

type RoleProvider is uint256;

using LibRoleProvider for RoleProvider global;

/// Encode `roleTimeToLive, providerAddress, pullProviderIndex` members into a RoleProvider
function encodeRoleProvider(uint32 roleTimeToLive, address providerAddress, uint24 pullProviderIndex) pure returns (RoleProvider roleProvider) {
  assembly {
    roleProvider := or(or(shl(0xe0, roleTimeToLive), shl(0x40, providerAddress)), shl(0x28, pullProviderIndex))
  }
}

library LibRoleProvider {
  /// Extract `roleTimeToLive, providerAddress, pullProviderIndex` members from a RoleProvider
  function decodeRoleProvider(RoleProvider roleProvider) internal pure returns (uint32 _roleTimeToLive, address _providerAddress, uint24 _pullProviderIndex) {
    assembly {
      _roleTimeToLive := shr(0xe0, roleProvider)
      _providerAddress := shr(0x60, shl(0x20, roleProvider))
      _pullProviderIndex := shr(0xe8, shl(0xc0, roleProvider))
    }
  }

  /// Extract roleTimeToLive from roleProvider
  function roleTimeToLive(RoleProvider roleProvider) internal pure returns (uint32 _roleTimeToLive) {
    assembly {
      _roleTimeToLive := shr(0xe0, roleProvider)
    }
  }

  /// Returns new RoleProvider with `roleTimeToLive` set to `_roleTimeToLive`
  /// Note: This function does not modify the original RoleProvider
  function setRoleTimeToLive(RoleProvider roleProvider, uint32 _roleTimeToLive) internal pure returns (RoleProvider newRoleProvider) {
    assembly {
      newRoleProvider := or(shr(0x20, shl(0x20, roleProvider)), shl(0xe0, _roleTimeToLive))
    }
  }

  /// Extract providerAddress from roleProvider
  function providerAddress(RoleProvider roleProvider) internal pure returns (address _providerAddress) {
    assembly {
      _providerAddress := shr(0x60, shl(0x20, roleProvider))
    }
  }

  /// Returns new RoleProvider with `providerAddress` set to `_providerAddress`
  /// Note: This function does not modify the original RoleProvider
  function setProviderAddress(RoleProvider roleProvider, address _providerAddress) internal pure returns (RoleProvider newRoleProvider) {
    assembly {
      newRoleProvider := or(and(roleProvider, 0xffffffff0000000000000000000000000000000000000000ffffffffffffffff), shl(0x40, _providerAddress))
    }
  }

  /// Extract pullProviderIndex from roleProvider
  function pullProviderIndex(RoleProvider roleProvider) internal pure returns (uint24 _pullProviderIndex) {
    assembly {
      _pullProviderIndex := shr(0xe8, shl(0xc0, roleProvider))
    }
  }

  /// Returns new RoleProvider with `pullProviderIndex` set to `_pullProviderIndex`
  /// Note: This function does not modify the original RoleProvider
  function setPullProviderIndex(RoleProvider roleProvider, uint24 _pullProviderIndex) internal pure returns (RoleProvider newRoleProvider) {
    assembly {
      newRoleProvider := or(and(roleProvider, 0xffffffffffffffffffffffffffffffffffffffffffffffff000000ffffffffff), shl(0x28, _pullProviderIndex))
    }
  }
}