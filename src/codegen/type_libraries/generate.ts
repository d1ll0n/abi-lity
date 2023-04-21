/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  assert,
  coerceArray,
  ContractKind,
  FunctionDefinition,
  isInstanceOf,
  staticNodeFactory,
  StructDefinition,
  UserDefinedValueTypeDefinition
} from "solc-typed-ast";
import {
  ArrayType,
  BytesType,
  FunctionType,
  StringType,
  StructType,
  TypeNode,
  ValueType
} from "../../ast";
import { addDefinitionImports, CompileHelper, isExternalFunction, toHex, wrap } from "../../utils";
import { snakeCaseToCamelCase, snakeCaseToPascalCase } from "../names";
import { CodegenContext, ContractCodegenContext } from "../utils";
import { astDefinitionToTypeNode, structDefinitionToTypeNode } from "../../readers";
import path from "path";

function getScuffMethods(member: TypeNode): string[] {
  const label = member.labelFromParent;
  const functions: string[] = [];
  if (member.isValueType && member.exactBits !== undefined && member.exactBits < 256) {
    functions.push(snakeCaseToCamelCase(`addDirtyBitsTo_${label}`));
    if ((member as ValueType).max()) {
      functions.push(snakeCaseToCamelCase(`overflow_${label}`));
    }
  }

  if (member.isDynamicallyEncoded) {
    functions.push(`addDirtyBitsTo${snakeCaseToPascalCase(`${label}_offset`)}`);
  }
  if (isInstanceOf(member, ArrayType, BytesType)) {
    functions.push(`addDirtyBitsToLength`);
  }
  return functions;
}

function getTupleMemberOffsetFunctions(
  contract: ContractCodegenContext,
  parentPointerType: string,
  member: TypeNode
) {
  const label = member.labelFromParent;

  const offsetName = `${label}Offset`;
  //NameGen.structMemberOffset(member, EncodingScheme.ABI);
  const offsetValue = member.calldataHeadOffset;
  const offsetRef =
    offsetValue === 0 ? undefined : contract.addConstant(offsetName, toHex(offsetValue));

  const headName = `${label}${member.isDynamicallyEncoded ? `Head` : ""}`;

  const pointerOutput = "MemoryPointer";
  const comment = [
    `/// @dev Resolve the pointer to the head of \`${label}\` in memory.`,
    `///     ${
      member.isDynamicallyEncoded
        ? `This points to the offset of the item's data relative to \`ptr\``
        : `This points to the beginning of the encoded \`${member.signatureInExternalFunction(
            true
          )}\``
    }`
  ];
  addMemberOffsetFunction(contract, headName, parentPointerType, pointerOutput, offsetRef, comment);

  if (member.isReferenceType) {
    const memberPointerType = generateReferenceTypeLibrary(
      contract.sourceUnitContext,
      member,
      true
    ).pointerName;
    const dataName = `${label}Data`;
    const position = member.isDynamicallyEncoded
      ? `ptr.unwrap().offset(${headName}(ptr).readUint256())`
      : `${headName}(ptr)`;
    contract.addFunction(dataName, [
      `/// @dev Resolve the \`${memberPointerType}\` pointing to the data buffer of \`${label}\``,
      `function ${dataName}(${parentPointerType} ptr) internal pure returns (${memberPointerType}) {`,
      [`return ${memberPointerType}Library.wrap(${position});`],
      `}`
    ]);
  }

  if (member.isDynamicallyEncoded) {
    const suffix = snakeCaseToPascalCase(`${label}_offset`);
    const dirtyBitsName = `addDirtyBitsTo${suffix}`;
    contract.addFunction(dirtyBitsName, [
      `/// @dev Add dirty bits to the head for \`${label}\` (offset relative to parent).`,
      `function ${dirtyBitsName}(${parentPointerType} ptr) internal pure {`,
      [`${headName}(ptr).addDirtyBitsBefore(224);`],
      `}`
    ]);
  }

  if (member.isValueType && member.exactBits !== undefined && member.exactBits < 256) {
    const addDirtyBitsFn = snakeCaseToCamelCase(`addDirtyBitsTo_${label}`);
    const [dirtyBitsFn, offset] = member.leftAligned
      ? [`addDirtyBitsAfter`, member.exactBits]
      : [`addDirtyBitsBefore`, 256 - member.exactBits];
    contract.addFunction(addDirtyBitsFn, [
      `/// @dev Add dirty bits to \`${label}\``,
      `function ${addDirtyBitsFn}(${parentPointerType} ptr) internal pure {`,
      [`${headName}(ptr).${dirtyBitsFn}(${toHex(offset)});`],
      `}`
    ]);
    const maxValue = (member as ValueType).max();
    if (maxValue) {
      const overflowName = snakeCaseToPascalCase(`overflowed_${label}`);
      const overvlowValue = toHex(maxValue + BigInt(1));
      contract.addConstant(overflowName, overvlowValue);

      const overflowFn = snakeCaseToCamelCase(`overflow_${label}`);
      contract.addFunction(overflowFn, [
        `/// @dev Cause \`${label}\` to overflow`,
        `function ${overflowFn}(${parentPointerType} ptr) internal pure {`,
        [`${headName}(ptr).write(${overflowName});`],
        `}`
      ]);
    }
  }
}

/* type ScuffType = {
  kind: 'DirtyBits' | 'ArraySwap' | 'Overflow';
  functionName: string;
  
} */

type TypePointerLibrary = {
  library: ContractCodegenContext;
  pointerName: string;
  libraryName: string;
  pointerType: UserDefinedValueTypeDefinition;
  ctx: CodegenContext;
};

function generateTypeAndLibrary(parentCtx: CodegenContext, type: TypeNode): TypePointerLibrary {
  const pointerName = `${type.pascalCaseName}Pointer`;
  const libraryName = `${pointerName}Library`;
  const sourceUnitName = parentCtx.decoderSourceUnitName.replace(
    path.basename(parentCtx.decoderSourceUnitName),
    `${libraryName}.sol`
  );
  const helper = parentCtx.helper;
  let ctx: CodegenContext;
  if (parentCtx.decoderSourceUnitName === sourceUnitName) {
    ctx = parentCtx;
  } else {
    ctx = new CodegenContext(helper, sourceUnitName, parentCtx.outputPath);
    ctx.addPointerLibraries();
  }
  const pointerType = ctx.addValueTypeDefinition(pointerName);
  const library = ctx.addContract(libraryName, ContractKind.Library);
  const signatureInComment =
    type instanceof FunctionType ? `calldata for` : type.signatureInExternalFunction(true);
  const libraryComment = [`@dev Library for resolving pointers of encoded ${signatureInComment}`];
  if (type instanceof StructType) {
    libraryComment.push(
      ...type
        .writeDefinition()
        .split("\n")
        .map((ln) => `${ln}`)
    );
  } else if (type instanceof FunctionType) {
    libraryComment.push(type.signature(true));
  }
  library.contract.documentation = staticNodeFactory.makeStructuredDocumentation(
    library.contract.requiredContext,
    libraryComment.join("\n")
  );
  ctx.addCustomTypeUsingForDirective(
    pointerName,
    staticNodeFactory.makeIdentifierPath(
      pointerType.requiredContext,
      libraryName,
      library.contract.id
    )
  );
  const wrapBody =
    type instanceof FunctionType
      ? [`return ${pointerName}.wrap(MemoryPointer.unwrap(ptr.offset(4)));`]
      : [`return ${pointerName}.wrap(MemoryPointer.unwrap(ptr));`];
  library.addFunction("wrap", [
    `/// @dev Convert a \`MemoryPointer\` to a \`${pointerName}\`.`,
    `///     This adds \`${libraryName}\` functions as members of the pointer`,
    `function wrap(MemoryPointer ptr) internal pure returns (${pointerName}) {`,
    wrapBody,
    `}`
  ]);
  library.addFunction("unwrap", [
    `/// @dev Convert a \`${pointerName}\` back into a \`MemoryPointer\`.`,
    `function unwrap(${pointerName} ptr) internal pure returns (MemoryPointer) {`,
    [`return MemoryPointer.wrap(${pointerName}.unwrap(ptr));`],
    `}`
  ]);

  return {
    library,
    pointerName,
    libraryName,
    pointerType,
    ctx
  };
}

function addMemberOffsetFunction(
  contract: ContractCodegenContext,
  fnName: string,
  pointerInput: string,
  pointerOutput: string,
  offsetRef?: string,
  comment?: string | string[]
) {
  const ln = [`ptr.unwrap()`];
  if (offsetRef) {
    ln.push(`.offset(${offsetRef})`);
  }
  if (pointerOutput !== `MemoryPointer`) {
    wrap(ln, `${pointerOutput}Library.wrap(`, `)`);
  }
  wrap(ln, `return `, `;`);
  contract.addFunction(fnName, [
    ...coerceArray(comment ?? []),
    `function ${fnName}(${pointerInput} ptr) internal pure returns (${pointerOutput}) {`,
    [ln.join("")],
    `}`
  ]);
}

function addLengthFunctions(
  library: ContractCodegenContext,
  pointerName: string,
  type: ArrayType | BytesType
) {
  assert(
    type.isDynamicallySized,
    `Can not add length functions for type without dynamic length: ${type.pp()}`
  );
  const nameInComment = type.signatureInExternalFunction(true);
  addMemberOffsetFunction(
    library,
    `length`,
    pointerName,
    `MemoryPointer`,
    undefined,
    `/// @dev Resolve the pointer for the length of the \`${nameInComment}\` at \`ptr\`.`
  );
  library.addFunction(`setLength`, [
    `/// @dev Set the length for the \`${nameInComment}\` at \`ptr\` to \`length\`.`,
    `function setLength(${pointerName} ptr, uint256 _length) internal pure {`,
    [`length(ptr).write(_length);`],
    `}`
  ]);
  library.addFunction(`setMaxLength`, [
    `/// @dev Set the length for the \`${nameInComment}\` at \`ptr\` to \`type(uint256).max\`.`,
    `function setMaxLength(${pointerName} ptr) internal pure {`,
    [`setLength(ptr, type(uint256).max);`],
    `}`
  ]);
  library.addFunction(`addDirtyBitsToLength`, [
    `/// @dev Add dirty bits from 0 to 224 to the length for the \`${nameInComment}\` at \`ptr\``,
    `function addDirtyBitsToLength(${pointerName} ptr) internal pure {`,
    [`length(ptr).addDirtyBitsBefore(224);`],
    `}`
  ]);
}

function generateStructLibrary(parentCtx: CodegenContext, type: StructType): TypePointerLibrary {
  const typeLibrary = generateTypeAndLibrary(parentCtx, type);
  const { library, pointerName } = typeLibrary;
  for (const member of type.vMembers) {
    getTupleMemberOffsetFunctions(library, pointerName, member);
  }
  if (type.isDynamicallyEncoded) {
    const tailOffset = library.addConstant(`HeadSize`, toHex(type.embeddedCalldataHeadSize));
    const comment = [
      `/// @dev Resolve the pointer to the tail segment of the struct.`,
      `///     This is the beginning of the dynamically encoded data.`
    ];
    addMemberOffsetFunction(library, `tail`, pointerName, `MemoryPointer`, tailOffset, comment);
  }
  return typeLibrary;
}

function generateFunctionLibrary(
  parentCtx: CodegenContext,
  type: FunctionType
): TypePointerLibrary {
  const typeLibrary = generateTypeAndLibrary(parentCtx, type);
  const { library, pointerName } = typeLibrary;
  library.addFunction("fromBytes", [
    `/// @dev Convert \`bytes\` with encoded calldata for \`${type.signatureInExternalFunction()}\`to a \`${pointerName}\`.`,
    `///     This adds \`${library.name}\` functions as members of the pointer`,
    `function fromBytes(MemoryPointer ptrIn) internal pure returns (${pointerName} ptrOut) {`,
    [
      `assembly {`,
      [
        `// Offset the pointer by 36 bytes to skip the function selector and length`,
        `ptrOut := add(ptrIn, 0x24)`
      ],
      `}`
    ],
    `}`
  ]);
  for (const member of type.parameters!.vMembers) {
    getTupleMemberOffsetFunctions(library, pointerName, member);
  }
  if (type.parameters!.isDynamicallyEncoded) {
    const tailOffset = library.addConstant(
      `HeadSize`,
      toHex(type.parameters!.embeddedCalldataHeadSize)
    );
    const comment = [
      `/// @dev Resolve the pointer to the tail segment of the encoded calldata.`,
      `///     This is the beginning of the dynamically encoded data.`
    ];
    addMemberOffsetFunction(library, `tail`, pointerName, `MemoryPointer`, tailOffset, comment);
  }
  return typeLibrary;
}

function generateArrayLibrary(parentCtx: CodegenContext, type: ArrayType): TypePointerLibrary {
  const typeLibrary = generateTypeAndLibrary(parentCtx, type);
  const { ctx, library, pointerName } = typeLibrary;
  const headName = type.baseType.isDynamicallyEncoded ? `elementHead` : `element`;

  const calldataStride: string = library.addConstant(`CalldataStride`, toHex(type.calldataStride));

  const headComment = [
    `/// @dev Resolve the pointer to the head of the array.`,
    `///     ${
      type.baseType.isDynamicallyEncoded
        ? `This points to the head value of the first item in the array`
        : `This points to the first item's data`
    }`
  ];

  addMemberOffsetFunction(
    library,
    `head`,
    pointerName,
    `MemoryPointer`,
    type.isDynamicallySized ? `_OneWord` : undefined,
    headComment
  );

  const headOffsetMember = type.isDynamicallySized
    ? `(index * ${calldataStride}) + 32`
    : `index * ${calldataStride}`;

  const comment = [
    `/// @dev Resolve the pointer to the head of \`arr[index]\` in memory.`,
    `///     ${
      type.baseType.isDynamicallyEncoded
        ? `This points to the offset of the item's data relative to \`ptr\``
        : `This points to the beginning of the encoded \`${type.signatureInExternalFunction(
            true
          )}\``
    }`
  ];

  library.addFunction(headName, [
    ...comment,
    `function ${headName}(${pointerName} ptr, uint256 index) internal pure returns (MemoryPointer) {`,
    [`return ptr.unwrap().offset(${headOffsetMember});`],
    `}`
  ]);

  if (type.isDynamicallySized) {
    addLengthFunctions(library, pointerName, type);
  }

  if (
    type.baseType.isValueType &&
    type.baseType.exactBits !== undefined &&
    type.baseType.exactBits < 256
  ) {
    const [dirtyBitsFn, offset] = type.baseType.leftAligned
      ? [`addDirtyBitsAfter`, type.baseType.exactBits]
      : [`addDirtyBitsBefore`, 256 - type.baseType.exactBits];
    library.addFunction(`addDirtyBitsToMember`, [
      `/// @dev Add dirty bits to \`arr[index]\``,
      `function addDirtyBitsToMember(${pointerName} ptr, uint256 index) internal pure {`,
      [`${headName}(ptr, index).${dirtyBitsFn}(${toHex(offset)});`],
      `}`
    ]);
    const maxValue = (type.baseType as ValueType).max();
    if (maxValue) {
      const overflowName = `Overflowed${type.baseType.pascalCaseName}`;
      const overvlowValue = toHex(maxValue + BigInt(1));
      library.addConstant(overflowName, overvlowValue);

      const overflowFn = `overflowMember`;
      library.addFunction(overflowFn, [
        `/// @dev Cause \`arr[index]\` to overflow`,
        `function ${overflowFn}(${pointerName} ptr, uint256 index) internal pure {`,
        [`${headName}(ptr, index).write(${overflowName});`],
        `}`
      ]);
    }
  }

  if (type.baseType.isReferenceType) {
    const memberPointerType = generateReferenceTypeLibrary(
      library.sourceUnitContext,
      type.baseType,
      true
    ).pointerName;
    const dataName = `elementData`;
    const position = type.baseType.isDynamicallyEncoded
      ? `ptr.unwrap().offset(${headName}(ptr, index).readUint256())`
      : `${headName}(ptr, index)`;
    library.addFunction(dataName, [
      `/// @dev Resolve the \`${memberPointerType}\` pointing to the data buffer of \`arr[index]\``,
      `function ${dataName}(${pointerName} ptr, uint256 index) internal pure returns (${memberPointerType}) {`,
      [`return ${memberPointerType}Library.wrap(${position});`],
      `}`
    ]);
  }

  if (type.baseType.isDynamicallyEncoded) {
    library.addFunction(`swap`, [
      `/// @dev Swap the head values of \`i\` and \`j\``,
      `function swap(${pointerName} ptr, uint256 i, uint256 j) internal pure {`,
      [
        `MemoryPointer head_i = ${headName}(ptr, i);`,
        `MemoryPointer head_j = ${headName}(ptr, j);`,
        `uint256 value_i = head_i.readUint256();`,
        `uint256 value_j = head_j.readUint256();`,
        `head_i.write(value_j);`,
        `head_j.write(value_i);`
      ],
      `}`
    ]);
    const tailOffset = type.isDynamicallySized
      ? `32 + (length(ptr).readUint256() * ${calldataStride})`
      : ctx.addConstant(`${type.identifier}_head_size`, toHex(type.embeddedCalldataHeadSize));
    const comment = [
      `/// @dev Resolve the pointer to the tail segment of the array.`,
      `///     This is the beginning of the dynamically encoded data.`
    ];
    addMemberOffsetFunction(library, `tail`, pointerName, `MemoryPointer`, tailOffset, comment);
  }

  return typeLibrary;
}

function generateBytesLibrary(parentCtx: CodegenContext, type: BytesType): TypePointerLibrary {
  const typeLibrary = generateTypeAndLibrary(parentCtx, type);
  const { ctx, library, pointerName } = typeLibrary;

  addLengthFunctions(library, pointerName, type);

  addMemberOffsetFunction(
    library,
    `data`,
    pointerName,
    `MemoryPointer`,
    `_OneWord`,
    `/// @dev Resolve the pointer to the beginning of the bytes data.`
  );

  library.addFunction(`addDirtyLowerBits`, [
    `/// @dev Add dirty bits to the end of the buffer if its length is not divisible by 32`,
    `function addDirtyLowerBits(${pointerName} ptr) internal pure {`,
    [
      `uint256 _length = length(ptr).readUint256();`,
      `uint256 remainder = _length % 32;`,
      `if (remainder > 0) {`,
      [
        `MemoryPointer lastWord = ptr.unwrap().next().offset(_length - remainder);`,
        `lastWord.addDirtyBitsAfter(8 * remainder);`
      ],
      `}`
    ],
    `}`
  ]);

  return typeLibrary;
}

function generateReferenceTypeLibrary(
  parentCtx: CodegenContext,
  type: TypeNode,
  addImport?: boolean
): TypePointerLibrary {
  assert(
    isInstanceOf(type, BytesType, StringType, StructType, ArrayType, FunctionType),
    `Can not generate pointer library for non-reference type: ${type.pp()}`
  );
  const helper = parentCtx.helper;
  const pointerName = `${type.pascalCaseName}Pointer`;
  const libraryName = `${pointerName}Library`;
  const sourceUnitName = parentCtx.decoderSourceUnitName.replace(
    path.basename(parentCtx.decoderSourceUnitName),
    `${libraryName}.sol`
  );

  let result: TypePointerLibrary;
  if (helper.hasSourceUnit(sourceUnitName)) {
    const ctx = new CodegenContext(helper, sourceUnitName, parentCtx.outputPath);
    const pointerType = ctx.sourceUnit
      .getChildrenByType(UserDefinedValueTypeDefinition)
      .find((t) => t.name === pointerName);
    assert(pointerType !== undefined, `Could not find type ${pointerName} in ${sourceUnitName}`);
    const library = ctx.addContract(libraryName, ContractKind.Library);
    result = {
      library,
      pointerName,
      libraryName,
      pointerType,
      ctx
    };
  } else if (type instanceof BytesType) {
    result = generateBytesLibrary(parentCtx, type);
  } else if (type instanceof StructType) {
    result = generateStructLibrary(parentCtx, type);
  } else if (type instanceof ArrayType) {
    result = generateArrayLibrary(parentCtx, type);
  } else {
    result = generateFunctionLibrary(parentCtx, type);
  }
  result.ctx.applyPendingContracts();
  if (addImport) {
    addDefinitionImports(parentCtx.sourceUnit, [result.pointerType]);
  }
  // result.library.applyPendingFunctions();
  return result;
}

export function buildPointerFiles(
  helper: CompileHelper,
  primaryFileName: string,
  decoderFileName = primaryFileName.replace(".sol", "Pointers.sol"),
  outPath?: string
): CodegenContext {
  if (outPath) {
    decoderFileName = path.join(outPath, path.basename(decoderFileName));
  }
  const ctx = new CodegenContext(helper, decoderFileName, outPath);

  const sourceUnit = helper.getSourceUnit(primaryFileName);

  const structs = sourceUnit
    .getChildrenByType(StructDefinition)
    .map((node) => astDefinitionToTypeNode(node));

  const functions = sourceUnit
    .getChildrenByType(FunctionDefinition)
    .filter((fn) => isExternalFunction(fn) && fn.vParameters.vParameters.length > 0)
    .map((node) => astDefinitionToTypeNode(node));

  [...structs, ...functions].forEach((type) => {
    generateReferenceTypeLibrary(ctx, type, true);
  });

  functions.sort((a, b) => {
    return b.parameters!.maxNestedDynamicTypes - a.parameters!.maxNestedDynamicTypes;
  });

  functions[0]
    .parameters!.getChildrenBySelector((t) => t.maxNestedDynamicTypes > 0)
    .forEach((t) => {
      console.log(`type: ${t.signatureInExternalFunction(true)}`);
    });

  ctx.applyPendingFunctions();
  ctx.applyPendingContracts();

  return ctx;
}
