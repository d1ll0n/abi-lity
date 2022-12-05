pragma solidity ^0.8.13;
import { OrderComponents, BasicOrderParameters, OrderParameters, Order, AdvancedOrder, OrderStatus, CriteriaResolver, Fulfillment, FulfillmentComponent, Execution } from "./ConsiderationStructs.sol";
import { OrderCombiner } from "./OrderCombiner.sol";

contract Consideration is OrderCombiner {
  constructor(address conduitController) OrderCombiner(conduitController) {}

  function fulfillBasicOrder(
    BasicOrderParameters calldata parameters
  ) external payable returns (bool fulfilled) {
    // Validate and fulfill the basic order.
    fulfilled = _validateAndFulfillBasicOrder(parameters);
  }

  function fulfillOrder(
    Order calldata order,
    bytes32 fulfillerConduitKey
  ) external payable returns (bool fulfilled) {
    // Convert order to "advanced" order, then validate and fulfill it.
    fulfilled = _validateAndFulfillAdvancedOrder(
      _convertOrderToAdvanced(order),
      new CriteriaResolver[](0), // No criteria resolvers supplied.
      fulfillerConduitKey,
      msg.sender
    );
  }

  function fulfillAdvancedOrder(
    AdvancedOrder calldata advancedOrder,
    CriteriaResolver[] calldata criteriaResolvers,
    bytes32 fulfillerConduitKey,
    address recipient
  ) external payable returns (bool fulfilled) {
    // Validate and fulfill the order.
    fulfilled = _validateAndFulfillAdvancedOrder(
      advancedOrder,
      criteriaResolvers,
      fulfillerConduitKey,
      _substituteCallerForEmptyRecipient(recipient)
    );
  }

  function fulfillAvailableOrders(
    Order[] calldata orders,
    FulfillmentComponent[][] calldata offerFulfillments,
    FulfillmentComponent[][] calldata considerationFulfillments,
    bytes32 fulfillerConduitKey,
    uint256 maximumFulfilled
  ) external payable returns (bool[] memory availableOrders, Execution[] memory executions) {
    // Convert orders to "advanced" orders and fulfill all available orders.
    return
      _fulfillAvailableAdvancedOrders(
        _convertOrdersToAdvanced(orders), // Convert to advanced orders.
        new CriteriaResolver[](0), // No criteria resolvers supplied.
        offerFulfillments,
        considerationFulfillments,
        fulfillerConduitKey,
        msg.sender,
        maximumFulfilled
      );
  }

  function fulfillAvailableAdvancedOrders(
    AdvancedOrder[] memory advancedOrders,
    CriteriaResolver[] calldata criteriaResolvers,
    FulfillmentComponent[][] calldata offerFulfillments,
    FulfillmentComponent[][] calldata considerationFulfillments,
    bytes32 fulfillerConduitKey,
    address recipient,
    uint256 maximumFulfilled
  ) external payable returns (bool[] memory availableOrders, Execution[] memory executions) {
    // Fulfill all available orders.
    return
      _fulfillAvailableAdvancedOrders(
        advancedOrders,
        criteriaResolvers,
        offerFulfillments,
        considerationFulfillments,
        fulfillerConduitKey,
        _substituteCallerForEmptyRecipient(recipient),
        maximumFulfilled
      );
  }

  function matchOrders(
    Order[] calldata orders,
    Fulfillment[] calldata fulfillments
  ) external payable returns (Execution[] memory executions) {
    // Convert to advanced, validate, and match orders using fulfillments.
    return
      _matchAdvancedOrders(
        _convertOrdersToAdvanced(orders),
        new CriteriaResolver[](0), // No criteria resolvers supplied.
        fulfillments
      );
  }

  function matchAdvancedOrders(
    AdvancedOrder[] memory advancedOrders,
    CriteriaResolver[] calldata criteriaResolvers,
    Fulfillment[] calldata fulfillments
  ) external payable returns (Execution[] memory executions) {
    // Validate and match the advanced orders using supplied fulfillments.
    return _matchAdvancedOrders(advancedOrders, criteriaResolvers, fulfillments);
  }

  function cancel(OrderComponents[] calldata orders) external returns (bool cancelled) {
    // Cancel the orders.
    cancelled = _cancel(orders);
  }

  function validate(Order[] calldata orders) external returns (bool validated) {
    // Validate the orders.
    validated = _validate(orders);
  }

  function incrementCounter() external returns (uint256 newCounter) {
    // Increment current counter for the supplied offerer.
    newCounter = _incrementCounter();
  }

  function getOrderHash(OrderComponents calldata order) external view returns (bytes32 orderHash) {
    // Derive order hash by supplying order parameters along with counter.
    orderHash = _deriveOrderHash(
      OrderParameters(
        order.offerer,
        order.zone,
        order.offer,
        order.consideration,
        order.orderType,
        order.startTime,
        order.endTime,
        order.zoneHash,
        order.salt,
        order.conduitKey,
        order.consideration.length
      ),
      order.counter
    );
  }

  function getOrderStatus(bytes32 orderHash) external view returns (bool, bool, uint256, uint256) {
    (bool isValidated, bool isCancelled, uint256 totalFilled, uint256 totalSize) = _getOrderStatus(
      orderHash
    );
    return (isValidated, isCancelled, totalFilled, totalSize);
  }

  function getCounter(address offerer) external view returns (uint256 counter) {
    counter = _getCounter(offerer);
  }

  function information() external view returns (string memory, bytes32, address) {
    (string memory version, bytes32 domainSeparator, address conduitController) = _information();
    return (version, domainSeparator, conduitController);
  }

  function getContractOffererNonce(address contractOfferer) external view returns (uint256 nonce) {
    nonce = _contractNonces[contractOfferer];
  }

  function name() external pure returns (string memory contractName) {
    contractName = _name();
  }
}
