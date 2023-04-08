import {
  assert,
  ASTNodeFactory,
  Block,
  DataLocation,
  FunctionCallKind,
  FunctionDefinition,
  Mutability,
  ParameterList,
  SourceUnit,
  StateVariableVisibility,
  VariableDeclaration
} from "solc-typed-ast";
import { ArrayType, FunctionType, StructType, TupleType, TypeNode } from "../../ast";
import {
  addUniqueFunctionDefinition,
  getParametersTypeString,
  makeGlobalFunctionDefinition,
  makeVariableDeclarationStatement,
  StructuredText,
  toHex
} from "../../utils";
import NameGen from "../names";
import { CodegenContext, getSequentiallyCopyableSegments } from "../utils";

const ensureHasName = (parameter: VariableDeclaration, i: number) => {
  if (!parameter.name) {
    parameter.name = `value${i}`;
  }
};

export function createReturnFunctionForReturnParameters(
  factory: ASTNodeFactory,
  returnParameters: ParameterList,
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

  // Get parameters with names
  const parametersList = factory.copy(returnParameters);
  const parameters = parametersList.vParameters;
  parameters.forEach(ensureHasName);

  // Define return function
  const returnFn = makeGlobalFunctionDefinition(
    decoderSourceUnit,
    name,
    factory.copy(returnParameters)
  );
  returnFn.vParameters.vParameters.forEach(ensureHasName);
  const body = returnFn.vBody as Block;

  const returnTypeString = getParametersTypeString(parameters);

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
  addUniqueFunctionDefinition(decoderSourceUnit, returnFn);

  return returnFn;
}

// function getOffset(parent: string, offset: number | string, pptr?: boolean): string {
//   const offsetString = typeof offset === "number" ? toHex(offset) : offset;
//   if (pptr) {
//     return `${parent}.pptr(${offset === 0 ? "" : offsetString})`;
//   }
//   return offset === 0 ? parent : `${parent}.offset(${offsetString})`;
// }

// function getMemberOffset(ctx: CodegenContext, type: TypeNode, location: DataLocation) {
//   const name = NameGen.structMemberOffset(type, location);
//   const offset =
//     location === DataLocation.CallData ? type.calldataHeadOffset : type.memoryHeadOffset;
//   const offsetString = offset === 0 ? "" : ctx.addConstant(name, toHex(offset));
//   const parentString = location === DataLocation.CallData ? "cdPtr" : "mPtr";
//   if (type.isDynamicallyEncoded && location === DataLocation.CallData) {
//     return `${parentString}.pptr(${offsetString})`;
//   }
//   return offsetString ? `${parentString}.offset(${offsetString})` : parentString;
// }

function abiEncodingFunctionBytes(ctx: CodegenContext): string {
  const fnName = `abi_encode_bytes`;
  if (ctx.hasFunction(fnName)) return fnName;
  const code = [
    `/// @dev Takes a bytes array in memory and copies it to a new location in`,
    `///      memory.`,
    `///`,
    `/// @param src A memory pointer referencing the bytes array to be copied (and`,
    `///            pointing to the length of the bytes array).`,
    `/// @param src A memory pointer referencing the location in memory to copy`,
    `///            the bytes array to (and pointing to the length of the copied`,
    `///            bytes array).`,
    `///`,
    `/// @return size The size of the encoded bytes array, including the size of the length.`,
    `function ${fnName}(MemoryPointer src, MemoryPointer dst) internal view returns (uint256 size) {`,
    [
      `unchecked {`,
      [
        `// Mask the length of the bytes array to protect against overflow`,
        `// and round up to the nearest word.`,
        `size = (src.readUint256() + AlmostTwoWords) & OnlyFullWordMask;`,
        `// Copy the bytes array to the new memory location.`,
        `src.copy(dst, size);`
      ],
      `}`
    ],
    `}`
  ];
  return ctx.addFunction(fnName, code);
}

/*


*/

// function abiEncodingFunctionStruct(ctx: CodegenContext, struct: StructType): string {
//   const sizeName = `${struct.identifier}_head_size`;
//   ctx.addConstant(sizeName, toHex(struct.embeddedMemoryHeadSize));
//   const body: StructuredText[] = [];
//   const segments = getSequentiallyCopyableSegments(struct);
//   segments.forEach((segment, i) => {
//     let size = toHex(segment.length * 32);
//     // If there's only one segment and it includes all members, the size name is
//     // just the name for the struct's head size.
//     if (segments.length === 1 && segment.length === struct.vMembers.length) {
//       size = sizeName;
//     } else {
//       const name = `${struct.identifier}_fixed_segment_${i}`;
//       size = ctx.addConstant(name, size);
//     }
//     const src = getMemberOffset(ctx, segment[0], DataLocation.CallData);
//     const dst = getMemberOffset(ctx, segment[0], DataLocation.Memory);

//     body.push(
//       `/// Copy ${segment.map((s) => s.labelFromParent).join(", ")}`,
//       `${src}.copy(${dst}, ${size});`
//     );
//   });

//   const referenceTypes = struct.vMembers.filter((type) => type.isReferenceType);
//   if (referenceTypes.length > 0) {
//     body.push(`uint256 `)
//   }
//   for (const member of referenceTypes) {
//     const src = getMemberOffset(ctx, member, DataLocation.CallData);
//     const dst = getMemberOffset(ctx, member, DataLocation.Memory);
//     const decodeFn = abiDecodingFunction(ctx, member);
//     body.push(`${dst}.write(${decodeFn}(${src}));`);
//   }

//   const fnName = NameGen.abiEncode(struct);
//   const code = getCalldataDecodingFunction(fnName, "cdPtr", "mPtr", body);
//   ctx.addFunction(fnName, code);
//   return fnName;
// }

export function abiEncodingFunction(ctx: CodegenContext, type: TypeNode): string {
  return "";
}

/* function createReturnForSimpleReferenceType(
  decoderSourceUnit: SourceUnit,
  factory: ASTNodeFactory,
  param: VariableDeclaration,
  type: TypeNode
) {
  if (type.hasEmbeddedReferenceTypes) {
    throw Error(`Can not create simple return function for type ${type.canonicalName}`);
  }
  const identifier = factory.makeYulIdentifierFor(param);
  const block = factory.makeYulBlock([]);
  let size: YulExpression;
  if (type.isDynamicallyEncoded) {
    if (isInstanceOf(type, BytesType, ArrayType)) {
      const varDecl = factory.makeYulVariableDeclaration(
        [factory.makeYulTypedName("length")],
        identifier.mload()
      );
      block.appendChild(varDecl);
      const lengthId = factory.makeYulIdentifierFor(varDecl);
      size =
        type instanceof BytesType
          ? roundUpAdd32(decoderSourceUnit, lengthId)
          : lengthId.mul(32).add(32);
    } else {
      throw Error(`Can not create simple return function for non-bytes, non-array type`);
    }
  } else {
    const sizeName = `${type.identifier}_size`;
    size = getYulConstant(decoderSourceUnit, sizeName, type.calldataHeadSize);
  }

  block.appendChild(
    factory.makeYulFunctionCall(factory.makeYulIdentifier("return"), [identifier, size])
  );
  return factory.makeInlineAssembly([], undefined, block);
} */

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
