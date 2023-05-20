pragma solidity ^0.8.13;


interface BaseContract1 {
  function externalFunction() external view returns (uint256);
  function stateVariable() external view returns (uint256);
}

contract BaseContract2 {
  uint256 public stateVariable3;
  function externalFunction() external view virtual returns (uint256) {}
  function stateVariable2() external view virtual returns (uint256) {
    return 90;
  }
}
struct SomeData {
  uint256[] arr;
}
struct Info {
  uint256 a;
  uint256[2] arr;
  uint256[] arr2;
  bytes data;
  SomeData nestedStruct;
}

contract ChildContract is BaseContract1, BaseContract2 {
  function externalFunction() external view virtual override(BaseContract1, BaseContract2) returns (uint256 u) {
    return 200;
  }

  uint256 public override stateVariable;

  mapping(address => mapping (uint256 => address)) public mappedData;
  mapping(address => Info) public mappedData1;

  function fnWithPubRef() external {
    BaseContract2.stateVariable3 += 1;
  }

  constructor() {
    uint256[2] memory arr = [uint256(1), uint256(2)];
    uint256[] memory arr2 = new uint256[](2);
    arr2[0] = 1;
    arr2[1] = 2;
    mappedData1[msg.sender] = Info(1, arr, arr2, "test", SomeData(arr2));
    mappedData[msg.sender][1] = msg.sender;
    stateVariable++;
  }
 }

 interface IX {}

 library SomeLib {
  function onUint(uint256 x) internal pure returns (uint256) {
    return x;
  }
 }

 contract SecondaryContract {
  ChildContract public childContract = new ChildContract();
  event SomeLog(uint256 a, address indexed b);


  function doThing() external view returns (IX) {
    IX x = IX(address(childContract));
    return x;
  }

  function test() external  {
    (
      uint256 a,
      bytes memory data,
      SomeData memory nestedStruct
    ) = childContract.mappedData1(address(this));
    require (a == 1);
    require(keccak256(data) == keccak256("test"));
    require(nestedStruct.arr[0] == 1);
    require(nestedStruct.arr[1] == 2);
    address addr = childContract.mappedData(address(this), 1);
    require(addr == address(this));
    require(childContract.stateVariable() == 1);
    require(childContract.stateVariable2() == 90);
    require(childContract.externalFunction() == 200);
    emit SomeLog(a, address(this));
  }

  function _kek(bytes memory data) internal pure returns (bytes32) {
    return keccak256(abi.encode(data, uint256(90)));
  }

  function testFunction(bytes memory data) external pure returns (bytes32 x) {
    return keccak256(abi.encode(data, uint256(90)));
  }

  function encodeData(bytes memory data) external pure returns (bytes memory) {
    return abi.encode(data, uint256(90));
  }
 }