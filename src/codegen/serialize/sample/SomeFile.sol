struct Item {
  uint256 x;
  uint40 y;
  bool isValue;
}

struct Data {
  Item item;
  Item[] additionalItems;
}