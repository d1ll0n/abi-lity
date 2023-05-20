import "./Structs.sol";

contract BaseCopier {
  function copy_tuple_ABC(ABC calldata input0) external view returns (ABC memory output0) {
    return (input0);
  }
}