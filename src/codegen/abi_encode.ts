import {
  ASTNodeFactory,
  Block,
  DataLocation,
  FunctionCallKind,
  FunctionDefinition,
  Mutability,
  SourceUnit,
  StateVariableVisibility,
  VariableDeclaration
} from "solc-typed-ast";
import { FunctionType, TupleType } from "../ast";
import { makeGlobalFunctionDefinition, makeVariableDeclarationStatement } from "../utils";

const ensureHasName = (parameter: VariableDeclaration, i: number) => {
  if (!parameter.name) {
    parameter.name = `value${i}`;
  }
};

export function createReturnFunctionForReturnParameters(
  factory: ASTNodeFactory,
  fn: FunctionDefinition,
  fnType: FunctionType,
  decoderSourceUnit: SourceUnit
): FunctionDefinition {
  if (!fnType.returnParameters) {
    throw Error(`Can not make return function for function with no return parameters`);
  }
  const tuple = fnType.returnParameters as TupleType;
  const paramIdentifier =
    tuple.vMembers.length === 1 ? tuple.vMembers[0].identifier : tuple.identifier;
  const name = `return_${paramIdentifier}`;

  const parametersList = factory.copy(fn.vReturnParameters);
  const parameters = parametersList.vParameters;
  parameters.forEach(ensureHasName);
  const returnFn = makeGlobalFunctionDefinition(
    decoderSourceUnit,
    name,
    factory.copy(fn.vReturnParameters)
  );
  returnFn.vParameters.vParameters.forEach(ensureHasName);
  const body = returnFn.vBody as Block;

  const paramTypeStrings = parameters.map((v) => v.typeString);
  const returnTypeString = (
    paramTypeStrings.length > 1 ? `tuple(${paramTypeStrings.join(",")})` : paramTypeStrings[0]
  )
    .replace(/(struct\s+)([\w\d]+)/g, "$1$2 memory")
    .replace(/\[\]/g, "[] memory");
  const ids = parameters.map((p) => factory.makeIdentifierFor(p));
  const abiEncode = factory.makeIdentifier(returnTypeString, `abi.encode`, -1);
  const encodeCall = factory.makeFunctionCall(
    returnTypeString,
    FunctionCallKind.FunctionCall,
    abiEncode,
    ids
  );

  const bytesTypeName = factory.makeElementaryTypeName("bytes", "bytes", "nonpayable");
  const returnData = factory.makeVariableDeclaration(
    false,
    false,
    `returnData`,
    returnFn.id,
    false,
    DataLocation.Memory,
    StateVariableVisibility.Default,
    Mutability.Mutable,
    "",
    undefined,
    bytesTypeName
  );
  const returnDataDecl = makeVariableDeclarationStatement(returnData, encodeCall);
  body.appendChild(returnDataDecl);
  const returnDataId = factory.makeYulIdentifierFor(returnData);
  const returnCall = factory.makeYulFunctionCall(factory.makeYulIdentifier("return"), [
    returnDataId.add(32),
    returnDataId.mload()
  ]);
  const asm = factory.makeYulBlock([returnCall]);
  body.appendChild(factory.makeInlineAssembly([], undefined, asm));
  decoderSourceUnit.appendChild(returnFn);

  return returnFn;
}

// function createReturnForSimpleReferenceType(
//   decoderSourceUnit: SourceUnit,
//   factory: ASTNodeFactory,
//   param: VariableDeclaration,
//   type: TypeNode
// ) {
//   if (type.hasEmbeddedReferenceTypes) {
//     throw Error(`Can not create simple return function for type ${type.canonicalName}`);
//   }
//   const identifier = factory.makeYulIdentifierFor(param);
//   const block = factory.makeYulBlock([]);
//   let size: YulExpression;
//   if (type.isDynamicallyEncoded) {
//     if (isInstanceOf(type, BytesType, ArrayType)) {
//       const varDecl = factory.makeYulVariableDeclaration(
//         [factory.makeYulTypedName("length")],
//         identifier.mload()
//       );
//       block.appendChild(varDecl);
//       const lengthId = factory.makeYulIdentifierFor(varDecl);
//       size =
//         type instanceof BytesType
//           ? roundUpAdd32(decoderSourceUnit, lengthId)
//           : lengthId.mul(32).add(32);
//     } else {
//       throw Error(`Can not create simple return function for non-bytes, non-array type`);
//     }
//   } else {
//     const sizeName = `${type.identifier}_size`;
//     size = getYulConstant(decoderSourceUnit, sizeName, type.calldataHeadSize);
//   }

//   block.appendChild(
//     factory.makeYulFunctionCall(factory.makeYulIdentifier("return"), [identifier, size])
//   );
//   return factory.makeInlineAssembly([], undefined, block);
// }

// function createReturnForValueType(
//   factory: ASTNodeFactory,
//   param: VariableDeclaration,
//   type: TypeNode,
//   decoderSourceUnit: SourceUnit
// ) {
//   if (!type.isValueType) {
//     throw Error(`TypeNode not a value type: ${type.canonicalName}`);
//   }
//   const identifier = factory.makeYulIdentifierFor(param);

//   const block = factory.makeYulBlock([
//     factory.makeYulLiteral(YulLiteralKind.Number, toHex(0), "").mstore(identifier),
//     factory.makeYulFunctionCall(factory.makeYulIdentifier("return"), [
//       factory.makeYulLiteral(YulLiteralKind.Number, toHex(0), ""),
//       factory.makeYulLiteral(YulLiteralKind.Number, toHex(32), "")
//     ])
//   ]);
// }

// /**
//  * Generates an ABI decoding function for an array of fixed-size reference types
//  * that can be combined into a single copy (no embedded reference types).
//  */
// function abiEncodingFunctionArrayCombinedStaticTail(ctx: DecoderContext, type: ArrayType): string {
//   const typeName = type.identifier;
//   const fnName = `abi_encode_${typeName}`;
//   if (ctx.hasFunction(fnName)) return fnName;
//   const tailSizeName = ctx.addConstant(
//     `${type.baseType.identifier}_mem_tail_size`,
//     toHex(type.baseType.memoryDataSize as number)
//   );

//   const headSetter: string[] = [];
//   let inPtr = "cdPtrLength";
//   let outPtr = "mPtrLength";
//   let tailSizeExpression = `mul(arrLength, ${tailSizeName})`;
//   let copyStartExpression = "add(cdPtrLength, 0x20)";
//   if (type.isDynamicallySized) {
//     headSetter.push(
//       `let arrLength := calldataload(cdPtrLength)`,
//       ``,
//       `mPtrLength := mload(0x40)`,
//       `mstore(mPtrLength, arrLength)`,
//       ``,
//       `let mPtrHead := add(mPtrLength, 32)`,
//       `let mPtrTail := add(mPtrHead, mul(arrLength, 0x20))`
//     );
//   } else {
//     inPtr = "cdPtrHead";
//     outPtr = "mPtrHead";
//     headSetter.push(
//       `mPtrHead := mload(0x40)`,
//       `let mPtrTail := add(mPtrHead, ${toHex(32 * (type.length as number))})`
//       // `let arrLength := ${type.length}`,
//       // `let tailOffset := ${toHex((type.length as number) * 32)}`
//     );
//     tailSizeExpression = ctx.addConstant(
//       `${type.identifier}_mem_tail_size`,
//       toHex(type.memoryDataSize as number)
//     );
//     copyStartExpression = inPtr;
//   }

//   const code = [
//     `function ${fnName}(${inPtr}) -> ${outPtr} {`,
//     [
//       ...headSetter,
//       `let mPtrTailNext := mPtrTail`,
//       ` `,
//       `// Copy elements to memory`,
//       `// Calldata does not have individual offsets for array elements with a fixed size.`,
//       `calldatacopy(`,
//       [`mPtrTail,`, `${copyStartExpression},`, tailSizeExpression],
//       `)`,
//       "let mPtrHeadNext := mPtrHead",
//       ` `,
//       `for {} lt(mPtrHeadNext, mPtrTail) {} {`,
//       `  mstore(mPtrHeadNext, mPtrTailNext)`,
//       `  mPtrHeadNext := add(mPtrHeadNext, 0x20)`,
//       `  mPtrTailNext := add(mPtrTailNext, ${tailSizeName})`,
//       `}`,
//       `mstore(0x40, mPtrTailNext)`
//     ],
//     `}`
//   ];
//   ctx.addFunction(fnName, code);
//   return fnName;
// }

// function abiEncodingFunctionArrayValue(
//   factory: ASTNodeFactory,
//   param: VariableDeclaration,
//   type: ArrayType,
//   decoderSourceUnit: SourceUnit
// ) {
//   if (!type.baseType.isValueType) {
//     throw Error(
//       `Can not make value-array encoding function for array of ${type.baseType.identifier}`
//     );
//   }
//   const typeName = type.identifier;
//   const fnName = `abi_encode_${typeName}`;
//   const inner: StructuredText[] = [];
//   if (type.isDynamicallySized) {
//     inner.push(`unchecked {`, [`uint256 length = src.read();`, `size = (length + 1) * 32;`], `}`);
//   } else {
//     inner.push(`size = ${toHex(type.calldataHeadSize)};`);
//   }
//   const code = [
//     `function ${fnName}(MemoryPointer src, MemoryPointer dst) pure returns (uint256 size) {`,
//     [...inner, `src.copy(dst, size);`],
//     "}"
//   ];
// }
