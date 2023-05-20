pragma solidity ^0.8.17;

import { ABC } from "./Structs.sol";
import "./PointerLibraries.sol";

uint256 constant ABC_mem_head_size = 0x60;
uint256 constant ABC_head_size = 0x60;
uint256 constant ABC_x_offset = 0x20;
uint256 constant ABC_c_offset = 0x40;

function _abi_decode_ABC(CalldataPointer cdPtr) pure returns (MemoryPointer mPtr) {
  mPtr = malloc(ABC_mem_head_size);
  cdPtr.copy(mPtr, ABC_mem_head_size);
}

function with_ABC_ReturnParameter(function(CalldataPointer) internal pure returns (MemoryPointer) inFn) pure returns (function(CalldataPointer) internal pure returns (ABC memory) outFn) {
  assembly {
    outFn := inFn
  }
}

function with_ABC_Parameter(function(MemoryPointer, MemoryPointer) internal pure returns (uint256) inFn) pure returns (function(ABC memory, MemoryPointer) internal pure returns (uint256) outFn) {
  assembly {
    outFn := inFn
  }
}

function _abi_encode_ABC(MemoryPointer src, MemoryPointer dst) pure returns (uint256 size) {
  size = ABC_head_size;
  /// Copy abc
  dst.write(src.readUint256());
  /// Copy x
  dst.offset(ABC_x_offset).write(src.offset(ABC_x_offset).readUint256());
  /// Copy c
  dst.offset(ABC_c_offset).write(src.offset(ABC_c_offset).readUint256());
}

function return_ABC(ABC memory value) pure {
  uint256 size = with_ABC_Parameter(_abi_encode_ABC)(value, ScratchPtr);
  ScratchPtr.returnData(size);
}