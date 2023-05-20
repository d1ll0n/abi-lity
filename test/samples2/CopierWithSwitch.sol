import "./Decoders2.sol";
import "./Structs.sol";

contract CopierWithSwitch {
  function copy_tuple_ABC() internal {
    ABC memory input0 = with_ABC_ReturnParameter(_abi_decode_ABC)(CalldataStart);
    return_ABC(input0);
  }

  fallback() virtual external payable {
    uint256 selector = uint256(uint32(msg.sig));
    if (selector == 0x92a782ef) return copy_tuple_ABC();
  }
}