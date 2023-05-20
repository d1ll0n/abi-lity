import "./Structs.sol";

contract BaseCopier {
  function copy_ABC(ABC calldata input) public view returns (ABC memory) {
    return input;
  }
}