/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  assert,
  ASTContext,
  coerceArray,
  ContractDefinition,
  ContractKind,
  DataLocation,
  EnumDefinition,
  FunctionDefinition,
  isInstanceOf,
  LiteralKind,
  SourceUnit,
  staticNodeFactory,
  StructDefinition,
  UserDefinedValueTypeDefinition
} from "solc-typed-ast";
import {
  ArrayType,
  BytesType,
  EnumType,
  FunctionType,
  StringType,
  StructType,
  TypeNode,
  ValueType
} from "../../ast";
import {
  addDefinitionImports,
  CompileHelper,
  DebugLogger,
  getDirectory,
  getRelativePath,
  isExternalFunction,
  StructuredText,
  toHex,
  wrap
} from "../../utils";
import { snakeCaseToCamelCase, snakeCaseToPascalCase } from "../names";
import { CodegenContext, ContractCodegenContext } from "../utils";
import { astDefinitionToTypeNode } from "../../readers";
import path from "path";
import { readFileSync } from "fs";
import { ConstantKind } from "../../utils/make_constant";

type ScuffOption = {
  name: string;
  resolvePointer: string;
  side: "upper" | "lower";
  bitOffset: number;
};

class ScuffDirectivesBuilder {
  constants: Array<[string, string]> = [];
  directives: StructuredText[] = [];
  scuffKinds: string[] = [];

  constructor(public type: TypeNode) {}

  get lastKind(): string {
    return this.scuffKinds[this.scuffKinds.length - 1];
  }

  get pointerName(): string {
    return `${this.type.pascalCaseName}Pointer`;
  }

  static getScuffDirectives(type: TypeNode) {
    const builder = new ScuffDirectivesBuilder(type);
    if (type instanceof BytesType) {
      builder.bytesDirectives();
    } else if (type instanceof ArrayType) {
      builder.arrayDirectives(type);
    } else if (isInstanceOf(type, StructType, FunctionType)) {
      builder.tupleDirectives(type);
    }
    return builder;
  }

  directive(
    pointerRef: string,
    side: "upper" | "lower",
    bitOffset: number | string,
    comment?: string
  ) {
    return [
      ...(comment ? [`/// @dev ${comment}`] : []),
      `directives.push(Scuff.${side}(uint256(ScuffKind.${this.lastKind}) + kindOffset, ${bitOffset}, ${pointerRef}));`
    ];
  }

  static addScuffDirectiveFunctions(library: ContractCodegenContext, type: TypeNode) {
    const ScuffDirectives = readFileSync(path.join(__dirname, "../ScuffDirectives.sol"), "utf8");
    const pointerLibraries = library.sourceUnitContext.getPointerLibraries();

    const scuffDirectives = library.sourceUnitContext.addSourceUnit(
      "ScuffDirectives.sol",
      ScuffDirectives.replace(
        "./PointerLibraries.sol",
        getRelativePath(
          getDirectory(library.sourceUnitContext.decoderSourceUnit.absolutePath),
          pointerLibraries.absolutePath
        )
      )
    );
    const builder = ScuffDirectivesBuilder.getScuffDirectives(type);

    library.addImports(scuffDirectives);
    library.sourceUnitContext.addCustomTypeUsingForDirective(
      `MemoryPointer`,
      staticNodeFactory.makeIdentifierPath(
        library.sourceUnit.requiredContext,
        `Scuff`,
        scuffDirectives.getChildrenByType(ContractDefinition)[0].id
      ),
      undefined,
      false,
      pointerLibraries
        .getChildrenByType(UserDefinedValueTypeDefinition)
        .find((child) => child.name === "MemoryPointer")!.id
    );
    if (builder.directives.length === 0 || builder.scuffKinds.length === 0) {
      return;
    }

    library.addEnum("ScuffKind", builder.scuffKinds);
    for (const [name, value] of builder.constants) {
      library.addConstant(name, value);
    }
    library.addFunction("addScuffDirectives", [
      `function addScuffDirectives(`,
      [`${builder.pointerName} ptr,`, `ScuffDirectivesArray directives,`, `uint256 kindOffset`],
      `) internal pure {`,
      [builder.directives],
      `}`
    ]);

    library.addFunction("getScuffDirectives", [
      `function getScuffDirectives(`,
      [`${builder.pointerName} ptr`],
      `) internal pure returns (ScuffDirective[] memory) {`,
      `ScuffDirectivesArray directives = Scuff.makeUnallocatedArray();`,
      `addScuffDirectives(ptr, directives, 0);`,
      `return directives.finalize();`,
      `}`
    ]);

    library.addFunction("toString", [
      `function toString(`,
      [`ScuffKind k`],
      `) internal pure returns (string memory) {`,
      builder.scuffKinds
        .slice(0, -1)
        .map((k) => `if (k == ScuffKind.${k}) return "${k}";`)
        .concat(`return "${builder.scuffKinds.slice(-1)[0]}";`),
      `}`
    ]);

    library.addFunction("toKind", [
      `function toKind(`,
      [`uint256 k`],
      `) internal pure returns (ScuffKind) {`,
      [`return ScuffKind(k);`],
      `}`
    ]);

    library.addFunction("toKindString", [
      `function toKindString(`,
      [`uint256 k`],
      `) internal pure returns (string memory) {`,
      [`return toString(toKind(k));`],
      `}`
    ]);
  }

  upper(pointerRef: string, bitOffset: number | string, comment?: string) {
    return this.directive(pointerRef, "upper", bitOffset, comment);
  }

  lower(pointerRef: string, bitOffset: number | string, comment?: string) {
    return this.directive(pointerRef, "lower", bitOffset, comment);
  }

  head(pointerRef: string, comment?: string) {
    return this.upper(pointerRef, 224, comment);
  }

  addKind(kind: string, memberLabel?: string) {
    kind = [...(memberLabel ? [memberLabel] : []), kind].join("_");
    this.scuffKinds.push(kind);
    return kind;
  }

  scuffLength() {
    this.scuffKinds.push(`LengthOverflow`);
    return this.lower(
      `ptr.length()`,
      224,
      `Overflow length of ${this.type.signatureInExternalFunction(true)}`
    );
  }

  scuffHead(label: string, pointerRef: string, comment?: string) {
    this.addKind("HeadOverflow", label);
    return this.lower(pointerRef, 224, comment);
  }

  scuffValue(
    label: string,
    pointerRef: string,
    side: "upper" | "lower",
    bitOffset: number,
    comment?: string
  ) {
    this.addKind("Overflow", label);
    return this[side](pointerRef, bitOffset, comment);
  }

  subDirectives(label: string, pointerRef: string, member: TypeNode) /* : string[] */ {
    const { scuffKinds } = ScuffDirectivesBuilder.getScuffDirectives(member);

    if (scuffKinds.length === 0) return [];

    const index = this.scuffKinds.length;
    const minimumKind = snakeCaseToPascalCase(`minimum_${label}_scuff_kind`);

    for (const kind of scuffKinds) this.addKind(kind, label);
    this.constants.push([minimumKind, `uint256(ScuffKind.${this.scuffKinds[index]})`]);

    const maximumKind = snakeCaseToPascalCase(`maximum_${label}_scuff_kind`);
    this.constants.push([maximumKind, `uint256(ScuffKind.${this.lastKind})`]);

    return [
      `/// @dev Add all nested directives in ${label}`,
      `${pointerRef}.addScuffDirectives(directives, kindOffset + ${minimumKind});`
    ];
  }

  bytesDirectives() {
    /* this.directives.push(this.scuffLength());
    this.scuffKinds.push(`DirtyLowerBits`);
    this.directives.push(
      `uint256 len = ptr.length().readUint256();`,
      `uint256 bitOffset = (len % 32) * 8;`,
      `if (len > 0 && bitOffset != 0) {`,
      [
        `MemoryPointer end = ptr.unwrap();`,
        `directives.push(Scuff.lower(uint256(ScuffKind.DirtyLowerBits) + kindOffset, bitOffset, end));`
      ],
      `}`
    ); */
  }

  arrayDirectives(type: ArrayType) {
    // if (type.isDynamicallySized) {
    //   this.directives.push(this.scuffLength());
    // }
    const length = type.isDynamicallySized ? `ptr.length().readUint256()` : type.length;
    const memberDirectives = this.getMemberDirective(`element`, `i`, type.baseType);
    if (memberDirectives.length > 0) {
      this.directives.push(
        `uint256 len = ${length};`,
        `for (uint256 i; i < len; i++) {`,
        memberDirectives,
        `}`
      );
    }
  }

  tupleDirectives(type: StructType | FunctionType) {
    const members = type instanceof FunctionType ? type.parameters!.vMembers : type.vMembers;
    this.directives = members.reduce(
      (directives, member) => [
        ...directives,
        ...this.getMemberDirective(member.labelFromParent!, ``, member)
      ],
      [] as StructuredText[]
    );
  }

  getMemberDirective(label: string, fnArgs: string, member: TypeNode) {
    const headName = `${label}${member.isDynamicallyEncoded ? `Head` : ""}`;
    const directives: StructuredText[] = [];

    if (member.isDynamicallyEncoded) {
      directives.push(
        this.scuffHead(label, `ptr.${headName}(${fnArgs})`, `Overflow offset for \`${label}\``)
      );
    }

    if (member.isValueType && member.exactBits !== undefined && member.exactBits < 256) {
      const [side, offset] = member.leftAligned
        ? ([`lower`, member.exactBits] as const)
        : ([`upper`, 256 - member.exactBits] as const);
      directives.push(
        this.scuffValue(
          label,
          `ptr.${headName}(${fnArgs})`,
          side,
          offset,
          `Induce overflow in \`${label}\``
        )
      );
    }

    if (member.isReferenceType) {
      const dataName = `${label}Data`;
      directives.push(this.subDirectives(label, `ptr.${dataName}(${fnArgs})`, member));
    }
    return directives;
  }
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

  // if (member.isDynamicallyEncoded) {
  //   const suffix = snakeCaseToPascalCase(`${label}_offset`);
  //   const dirtyBitsName = `addDirtyBitsTo${suffix}`;
  //   contract.addFunction(dirtyBitsName, [
  //     `/// @dev Add dirty bits to the head for \`${label}\` (offset relative to parent).`,
  //     `function ${dirtyBitsName}(${parentPointerType} ptr) internal pure {`,
  //     [`${headName}(ptr).addDirtyBitsBefore(224);`],
  //     `}`
  //   ]);
  // }

  if (member.isValueType && member.exactBits !== undefined && member.exactBits < 256) {
    const maxValue = (member as ValueType).max();

    if (maxValue && !member.leftAligned) {
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
    } else {
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
    }
  }
}

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
  /*   library.addFunction("toUint256", [
    `/// @dev Convert a \`${pointerName}\` to a raw uint256.`,
    `function toUint256(${pointerName} ptr) internal pure returns (MemoryPointer) {`,
    [`return ${pointerName}.unwrap(ptr);`],
    `}`
  ]); */

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
  // library.addFunction(`addDirtyBitsToLength`, [
  //   `/// @dev Add dirty bits from 0 to 224 to the length for the \`${nameInComment}\` at \`ptr\``,
  //   `function addDirtyBitsToLength(${pointerName} ptr) internal pure {`,
  //   [`length(ptr).addDirtyBitsBefore(224);`],
  //   `}`
  // ]);
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
  library.addConstant(`FunctionSelector`, type.functionSelector, ConstantKind.FixedBytes, 4);
  library.addFunction("isFunction", [
    `function isFunction(bytes4 selector) internal pure returns (bool) {`,
    [`return FunctionSelector == selector;`],
    `}`
  ]);
  library.addFunction("fromBytes", [
    `/// @dev Convert a \`bytes\` with encoded calldata for \`${type.signatureInExternalFunction()}\`to a \`${pointerName}\`.`,
    `///     This adds \`${library.name}\` functions as members of the pointer`,
    `function fromBytes(bytes memory data) internal pure returns (${pointerName} ptrOut) {`,
    [
      `assembly {`,
      [
        `// Offset the pointer by 36 bytes to skip the function selector and length`,
        `ptrOut := add(data, 0x24)`
      ],
      `}`
    ],
    `}`
  ]);
  const inputArgs = type.parameters!.writeParameter(DataLocation.Memory);
  const parameters = [
    `"${type.signature(false)}"`,
    ...type.parameters!.vMembers.map((m) => m.labelFromParent!)
  ].join(", ");
  const deps = type.parameters!.vMembers.map(getTypeDep);
  const depDefs = deps
    .filter(Boolean)
    .map((d) => lookupDefinition(parentCtx.sourceUnit.requiredContext, d!))
    .filter(Boolean);
  for (const dep of depDefs) {
    if (dep) {
      const p = dep.getClosestParentByType(SourceUnit) as SourceUnit;
      library.addImports(p, []);
    }
  }
  library.addFunction("fromArgs", [
    "/// @dev Encode function call from arguments",
    `function fromArgs${inputArgs} internal pure returns (${pointerName} ptrOut) {`,
    [`bytes memory data = abi.encodeWithSignature(${parameters});`, `ptrOut = fromBytes(data);`],
    `}`
  ]);
  library.addImports;
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

const getTypeDep = (type: TypeNode): StructType | EnumType | undefined => {
  if (type instanceof ArrayType) {
    return getTypeDep(type.baseType);
  } else if (type instanceof StructType) {
    return type;
  } else if (type instanceof EnumType) {
    return type;
  }
  return undefined;
};

function lookupDefinition(
  ctx: ASTContext,
  type: TypeNode
): StructDefinition | EnumDefinition | undefined {
  const dep = getTypeDep(type);
  if (!dep) return;
  const Kind = dep instanceof StructType ? StructDefinition : EnumDefinition;
  for (const n of ctx.nodes) {
    if (n instanceof Kind && n.name === type.identifier) {
      return n;
    }
  }
  return undefined;
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
  const alreadyExists = helper.hasSourceUnit(sourceUnitName);
  if (alreadyExists) {
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
  if (!alreadyExists) {
    ScuffDirectivesBuilder.addScuffDirectiveFunctions(result.library, type);
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
  outPath?: string,
  logger = new DebugLogger()
): { ctx: CodegenContext; functions: FunctionType[]; structs: StructType[] } {
  if (outPath) {
    decoderFileName = path.join(outPath, path.basename(decoderFileName));
  }
  console.log(`Building pointer libraries...`);
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
    logger.log(
      `Generating pointer library for ${
        type instanceof StructType ? type.identifier : type.signature(true)
      }...`
    );
    generateReferenceTypeLibrary(ctx, type, true);
  });

  ctx.applyPendingFunctions();
  ctx.applyPendingContracts();

  return { ctx, functions, structs };
}
