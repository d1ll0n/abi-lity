import {
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
import { ArrayType, BytesType, FunctionType, StructType, TupleType, TypeNode } from "../../ast";
import {
  addUniqueFunctionDefinition,
  getParametersTypeString,
  makeGlobalFunctionDefinition,
  makeVariableDeclarationStatement,
  StructuredText,
  toHex
} from "../../utils";
import NameGen from "../names";
import { CodegenContext, getEncodingFunction } from "../utils";
import { EncodingScheme } from "../../constants";
import { abiEncodingFunctionArray } from "./abi_encode_array";
import { getMemberDataOffset, getMemberHeadOffset } from "../offsets";
import { typeCastFunction } from "./type_cast";

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

function abiEncodingFunctionBytes(ctx: CodegenContext, type: BytesType): string {
  const fnName = NameGen.abiEncode(type);
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
    `function ${fnName}(MemoryPointer src, MemoryPointer dst) pure returns (uint256 size) {`,
    [
      `unchecked {`,
      [
        `// Mask the length of the bytes array to protect against overflow`,
        `// and round up to the nearest word.`,
        `size = (src.readUint256() + SixtyThreeBytes) & OnlyFullWordMask;`,
        `// Copy the bytes array to the new memory location.`,
        `src.copy(dst, size);`
      ],
      `}`
    ],
    `}`
  ];
  return ctx.addFunction(fnName, code);
}

function abiEncodingFunctionTuple(ctx: CodegenContext, tuple: TupleType): string {
  const innerParametersSignature = [
    `MemoryPointer`,
    ...tuple.vMembers.map(() => `MemoryPointer`)
  ].join(", ");

  const outerParametersSignature = [
    `MemoryPointer`,
    ...tuple.vMembers.map((member) => member.writeParameter(DataLocation.Memory, ""))
  ].join(", ");

  const castFnName = typeCastFunction(
    ctx,
    tuple,
    innerParametersSignature,
    `uint256`,
    outerParametersSignature,
    "uint256"
  );
  if (tuple.vMembers.length === 1 && !tuple.vMembers[0].isDynamicallyEncoded) {
    const fnName = abiEncodingFunction(ctx, tuple.vMembers[0]);
    return `${castFnName}(${fnName})`;
  }

  const fnName = NameGen.abiEncode(tuple);
  if (ctx.hasFunction(fnName)) return fnName;
  const sizeName = NameGen.headSize(tuple, EncodingScheme.ABI);
  ctx.addConstant(sizeName, toHex(tuple.embeddedCalldataHeadSize));
  const body: StructuredText[] = [`size = ${sizeName};`];

  for (const member of tuple.vMembers) {
    const src = member.labelFromParent;
    const dst = getMemberHeadOffset(ctx, "dst", member, EncodingScheme.ABI);
    if (member.isValueType) {
      body.push(`/// Copy ${member.labelFromParent}`, `${dst}.write(${src});`);
    } else if (member.isDynamicallyEncoded) {
      const encodeFn = abiEncodingFunction(ctx, member);
      body.push(
        `/// Write offset to ${member.labelFromParent} in head`,
        `${dst}.write(size);`,
        `/// Encode ${member.labelFromParent}`,
        `size += ${encodeFn}(${src}, dst.offset(size));`
      );
    } else {
      // Reference type that is not dynamically encoded - encoded in place
      const encodeFn = abiEncodingFunction(ctx, member);
      body.push(
        `/// Encode ${member.labelFromParent} in place in the head`,
        `${encodeFn}(${src}, ${dst});`
      );
    }
  }

  const parameters = [
    `MemoryPointer dst`,
    ...tuple.vMembers.map((member) => `MemoryPointer ${member.labelFromParent}`)
  ].join(", ");

  const code = [`function ${fnName}(${parameters}) pure returns (uint256 size) {`, body, `}`];
  ctx.addFunction(fnName, code);

  return `${castFnName}(${fnName})`;
}

function abiEncodingFunctionParameters(ctx: CodegenContext, type: FunctionType): string {
  const fnName = NameGen.abiEncode(type);
  const tuple = type.parameters;
  if (ctx.hasFunction(fnName)) return fnName;
  const sizeName = NameGen.parameterHeadSize(type, false);

  const selector = ctx.addConstant(`${type.name}_selector`, type.functionSelector.padEnd(66, "0"));
  const body: StructuredText[] = [`dst.write(${selector});`];

  if (tuple) {
    if (tuple.vMembers.every((m) => m.isValueType) && tuple.vMembers.length === 1) {
      ctx.addConstant(sizeName, toHex(tuple.embeddedCalldataHeadSize) + 4);
      body.push(`size = ${sizeName};`);
      const member = tuple.vMembers[0];
      body.push(
        `/// Write ${member.labelFromParent}`,
        `dst.offset(4).write(${member.labelFromParent});`
      );
    } else {
      const encodeParams = [
        "dst.offset(4)",
        ...tuple.vMembers.map((member) => member.labelFromParent)
      ].join(", ");
      const encodeFn = abiEncodingFunction(ctx, tuple);
      body.push(`/// Encode parameters`, `size = 4 + ${encodeFn}(${encodeParams});`);
    }
  } else {
    body.push(`size = 4;`);
  }

  const outerParameters = [
    `MemoryPointer dst`,
    ...(tuple ? tuple.vMembers.map((member) => member.writeParameter(DataLocation.Memory)) : [])
  ].join(", ");

  const code = [`function ${fnName}(${outerParameters}) pure returns (uint256 size) {`, body, `}`];
  ctx.addFunction(fnName, code);
  return fnName;
}

function abiEncodingFunctionStruct(ctx: CodegenContext, struct: StructType): string {
  const fnName = NameGen.abiEncode(struct);
  if (ctx.hasFunction(fnName)) return fnName;
  const sizeName = `${struct.identifier}_head_size`;
  ctx.addConstant(sizeName, toHex(struct.embeddedCalldataHeadSize));
  const body: StructuredText[] = [`size = ${sizeName};`];

  for (const member of struct.vMembers) {
    const src = getMemberDataOffset(ctx, "src", member, EncodingScheme.SolidityMemory);
    const dst = getMemberHeadOffset(ctx, "dst", member, EncodingScheme.ABI);
    if (member.isValueType) {
      body.push(`/// Copy ${member.labelFromParent}`, `${dst}.write(${src}.readUint256());`);
    } else if (member.isDynamicallyEncoded) {
      const encodeFn = abiEncodingFunction(ctx, member);
      body.push(
        `/// Write offset to ${member.labelFromParent} in head`,
        `${dst}.write(size);`,
        `/// Encode ${member.labelFromParent}`,
        `size += ${encodeFn}(${src}, dst.offset(size));`
      );
    } else {
      // Reference type that is not dynamically encoded - encoded in place
      const encodeFn = abiEncodingFunction(ctx, member);
      body.push(
        `/// Encode ${member.labelFromParent} in place in the head`,
        `${encodeFn}(${src}, ${dst});`
      );
    }
  }

  const code = getEncodingFunction(fnName, "src", "dst", body);
  ctx.addFunction(fnName, code);
  return fnName;
}

export function createReturnFunction(ctx: CodegenContext, type: TupleType): string {
  const fnName = NameGen.return(type);
  const encodeFn = abiEncodingFunction(ctx, type);
  const body = [];
  let dst = "dst";
  if (!type.isDynamicallyEncoded && type.embeddedCalldataHeadSize < 0x80) {
    dst = "ScratchPtr";
  } else {
    body.push(`MemoryPointer dst = getFreeMemoryPointer();`);
  }
  const encodeParams = [dst, ...type.vMembers.map((member) => member.labelFromParent)].join(", ");

  body.push(`uint256 size = ${encodeFn}(${encodeParams});`);
  body.push(`${dst}.returnData(size);`);

  const params = type.vMembers
    .map((member) => member.writeParameter(DataLocation.Memory))
    .join(", ");
  const code = [`function ${fnName}(${params}) pure {`, body, `}`];
  ctx.addFunction(fnName, code);
  return fnName;
}

export function abiEncodingFunction(ctx: CodegenContext, type: TypeNode): string {
  if (type instanceof ArrayType) {
    return abiEncodingFunctionArray(ctx, type);
  }
  if (type instanceof BytesType) {
    return abiEncodingFunctionBytes(ctx, type);
  }
  if (type instanceof StructType) {
    return abiEncodingFunctionStruct(ctx, type);
  }
  if (type instanceof TupleType) {
    return abiEncodingFunctionTuple(ctx, type);
  }
  if (type instanceof FunctionType) {
    return abiEncodingFunctionParameters(ctx, type);
  }
  throw Error(`Unsupported type: ${type.identifier}`);
}
