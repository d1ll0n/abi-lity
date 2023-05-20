import "./Decoders1.sol";
import "./Structs.sol";

contract CopierWithDecoders {
  function copy_tuple_ABC(ABC calldata) external view returns (ABC memory) {
    ABC memory input0 = with_ABC_ReturnParameter(_abi_decode_ABC)(CalldataStart);
    return_ABC(input0);
  }
}