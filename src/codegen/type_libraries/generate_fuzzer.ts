// // import {} from "scuffed-abi"
// import { defaultAbiCoder } from "@ethersproject/abi";
// import { assert } from "solc-typed-ast";
// import { TypeNode, ValueType } from "../../ast";
// import { maxUint } from "../../utils";
// defaultAbiCoder.encode();
// // decodeBytes
// // decodeOffer
// // decodeConsideration
// // decodeOrderParameters
// // decodeOrder
// // decodeAdvancedOrder
// // decodeOrderAsAdvancedOrder
// // decodeOrdersAsAdvancedOrders
// // decodeCriteriaResolver
// // decodeCriteriaResolvers
// // decodeOrders
// // decodeFulfillmentComponents
// // decodeNestedFulfillmentComponents
// // decodeAdvancedOrders
// // decodeFulfillment
// // decodeFulfillments
// // decodeOrderComponentsAsOrderParameters

// // Fuzzing strategy
// // For each type, have a limiting factor

// type TypeLimitation = {
//   maxValue: bigint;
// };

// class ArrayFuzzer {
//   baseType: TypeNode;
// }

// /**
//  * @dev Get a mask with dirty bits.
//  * If item is left aligned, dirty bits will be to the right of the encoded value's buffer.
//  * If item is right aligned, dirty bits will be to the left of the encoded value's buffer.
//  */
// function getDirtyBits(leftAligned: boolean, offset: number) {
//   if (leftAligned) return 64n >> BigInt(offset);
//   return 64n << BigInt(256 - offset);
// }

// type ValuePermutation = {
//   min: bigint;
//   max: bigint;
//   overflow?: bigint;
//   middle?: bigint;
// };

// const valuePermutationsMap: Map<string, ValuePermutation> = new Map();

// function getValueTypePermutations(type: ValueType): ValuePermutation {
//   let permutations = valuePermutationsMap.get(type.identifier);
//   if (permutations) {
//     return permutations;
//   }
//   const max = type.max();
//   const min = type.min();
//   assert(max !== undefined, `Undefined max value for ${type.pp()}`);
//   assert(min !== undefined, `Undefined min value for ${type.pp()}`);
//   assert(min < max, `min < max for ${type.pp()}`);
//   permutations = { min, max };
//   if (max > 1n) {
//     permutations.middle = max / 2n;
//   }
//   if (type.exactBits && type.exactBits < 256) {
//     permutations.overflow = max | getDirtyBits(type.leftAligned, type.exactBits);
//   }
//   valuePermutationsMap.set(type.identifier, permutations);
//   return permutations;
// }

// //function get
