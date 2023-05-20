pragma solidity ^0.8.17;

import { ABC } from "./Structs.sol";
import "./PointerLibraries.sol";

uint256 constant ABC_mem_head_size = 0x60;

function _abi_decode_ABC(CalldataPointer cdPtr) pure returns (MemoryPointer mPtr) {
  mPtr = malloc(ABC_mem_head_size);
  cdPtr.copy(mPtr, ABC_mem_head_size);
}

function with_ABC_ReturnParameter(function(CalldataPointer) internal pure returns (MemoryPointer) inFn) pure returns (function(CalldataPointer) internal pure returns (ABC memory) outFn) {
  assembly {
    outFn := inFn
  }
}