/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  assert,
  ASTContext,
  coerceArray,
  ContractDefinition,
  ContractKind,
  EnumDefinition,
  FunctionDefinition,
  isInstanceOf,
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
import { snakeCaseToPascalCase } from "../names";
import { CodegenContext, ContractCodegenContext } from "../utils";
import { astDefinitionToTypeNode } from "../../readers";
import path from "path";
import { ConstantKind } from "../../utils/make_constant";
import { getScuffDirectives } from "../solidity_libraries";

const canScuffLength = (type: TypeNode) => isInstanceOf(type, ArrayType, BytesType);
const canScuffHead = (type: TypeNode) => type.isDynamicallyEncoded;
const canScuffValue = (type: TypeNode) =>
  type.isValueType && type.exactBits !== undefined && type.exactBits < 256;
const canScuffData = (type: TypeNode) => type.isReferenceType;

const OPTIONS = {
  bytes: {
    setLowerBits: true
  },
  lengths: {
    setMax: true,
    setDirtyBits: true
  },
  heads: {
    setMax: true,
    setDirtyBits: true
  },
  elementary: {
    setMax: false,
    setDirtyBits: false
  }
} as const;

const canScuffElementaryType = (type: TypeNode, kind: "setMax" | "setDirtyBits") => {
  if (kind === "setDirtyBits") {
    return true;
  }
  if (type instanceof EnumType && kind === "setMax") return true;

  return false;
};
const canScuffReferenceType = (type: TypeNode) => {
  return type.getClosestParentByType(FunctionType)?.name.startsWith("fulfillBasicOrder");
};

class ScuffDirectivesBuilder {
  constants: Array<[string, string]> = [];
  directives: StructuredText[] = [];
  scuffKinds: string[] = [];
  scuffableFields: string[] = [];

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
    positions: string,
    comment?: string
  ) {
    return [
      ...(comment ? [`/// @dev ${comment}`] : []),
      `directives.push(Scuff.${side}(uint256(ScuffKind.${this.lastKind}) + kindOffset, ${bitOffset}, ${pointerRef}, ${positions}));`
    ];
  }

  static addScuffDirectiveFunctions(library: ContractCodegenContext, type: TypeNode) {
    const ScuffDirectives = getScuffDirectives();
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
    library.addEnum("ScuffableField", builder.scuffableFields);
    for (const [name, value] of builder.constants) {
      library.addConstant(name, value);
    }
    library.addFunction("addScuffDirectives", [
      `function addScuffDirectives(`,
      [
        `${builder.pointerName} ptr,`,
        `ScuffDirectivesArray directives,`,
        `uint256 kindOffset,`,
        `ScuffPositions positions`
      ],
      `) internal pure {`,
      [builder.directives],
      `}`
    ]);

    library.addFunction("getScuffDirectives", [
      `function getScuffDirectives(`,
      [`${builder.pointerName} ptr`],
      `) internal pure returns (ScuffDirective[] memory) {`,
      `ScuffDirectivesArray directives = Scuff.makeUnallocatedArray();`,
      `ScuffPositions positions = EmptyPositions;`,
      `addScuffDirectives(ptr, directives, 0, positions);`,
      `return directives.finalize();`,
      `}`
    ]);

    if (type instanceof FunctionType) {
      library.addFunction("getScuffDirectivesForCalldata", [
        `function getScuffDirectivesForCalldata(bytes memory data) internal pure returns (ScuffDirective[] memory) {`,
        [`return getScuffDirectives(fromBytes(data));`],
        `}`
      ]);
    }

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

  upper(pointerRef: string, bitOffset: number | string, positions: string, comment?: string) {
    return this.directive(pointerRef, "upper", bitOffset, positions, comment);
  }

  lower(pointerRef: string, bitOffset: number | string, positions: string, comment?: string) {
    return this.directive(pointerRef, "lower", bitOffset, positions, comment);
  }

  head(pointerRef: string, positions: string, comment?: string) {
    return this.upper(pointerRef, 224, positions, comment);
  }

  addKind(
    kind: string,
    // type: string,
    memberLabel?: string
    // memberPath = memberLabel,
    // path?: string
  ) {
    if (memberLabel && !this.scuffableFields.includes(memberLabel)) {
      this.scuffableFields.push(memberLabel);
    }
    kind = [...(memberLabel ? [memberLabel] : []), kind].join("_");
    // path = [...(memberPath ? [memberPath] : []), ...(path ? [path] : [])].join(".");
    this.scuffKinds.push(kind);
    return kind;
  }

  getScuffDirtyBits(
    label: string,
    pointerRef: string,
    leftAligned: boolean,
    exactBits: number,
    positions: string,
    comment?: string
  ) {
    this.addKind("DirtyBits", label);
    const [dirtyBitsSide, dirtyBitsOffset] = leftAligned
      ? ([`lower`, exactBits] as const)
      : ([`upper`, 256 - exactBits] as const);
    return this[dirtyBitsSide](pointerRef, dirtyBitsOffset, positions, comment);
  }

  getScuffMaxValue(
    label: string,
    pointerRef: string,
    leftAligned: boolean,
    exactBits: number,
    positions: string,
    comment?: string
  ) {
    this.addKind("MaxValue", label);
    const [maxSide, maxOffset] = leftAligned
      ? ([`upper`, exactBits] as const)
      : ([`lower`, 261 - exactBits] as const);
    return this[maxSide](pointerRef, maxOffset, positions, comment);
  }

  scuffLength(positions: string) {
    if (!canScuffReferenceType(this.type)) return [];
    if (!this.scuffableFields.includes("length")) {
      this.scuffableFields.push("length");
    }
    return [
      OPTIONS.lengths.setDirtyBits &&
        this.getScuffDirtyBits(
          `length`,
          `ptr.length()`,
          false,
          32,
          positions,
          `Add dirty upper bits to length`
        ),
      OPTIONS.lengths.setMax &&
        this.getScuffMaxValue(
          `length`,
          `ptr.length()`,
          false,
          32,
          positions,
          `Set every bit in length to 1`
        )
    ].filter((x) => x !== undefined) as any as string[];
  }

  scuffHead(label: string, pointerRef: string, positions: string, comment?: string) {
    return [
      OPTIONS.heads.setDirtyBits &&
        this.getScuffDirtyBits(
          `${label}_head`,
          pointerRef,
          false,
          32,
          positions,
          `Add dirty upper bits to ${label} head`
        ),
      OPTIONS.heads.setMax &&
        this.getScuffMaxValue(
          `${label}_head`,
          pointerRef,
          false,
          32,
          positions,
          `Set every bit in length to 1`
        )
    ].filter((x) => x !== undefined) as any as string[];
  }

  scuffValue(
    label: string,
    pointerRef: string,
    side: "upper" | "lower",
    bitOffset: number,
    positions: string,
    kind: string,
    comment?: string
  ) {
    this.addKind(kind, label);
    return this[side](pointerRef, bitOffset, positions, comment);
  }

  subDirectives(
    label: string,
    pointerRef: string,
    member: TypeNode,
    positions: string
  ) /* : string[] */ {
    const { scuffKinds } = ScuffDirectivesBuilder.getScuffDirectives(member);

    if (scuffKinds.length === 0) return [];

    const index = this.scuffKinds.length;
    const minimumKind = snakeCaseToPascalCase(`minimum_${label}_scuff_kind`);
    // scuffKinds.forEach((kind, i) => {
    //   const path = scuffKindPaths[i];
    // });
    for (const kind of scuffKinds) this.addKind(kind, label);
    this.constants.push([minimumKind, `uint256(ScuffKind.${this.scuffKinds[index]})`]);

    const maximumKind = snakeCaseToPascalCase(`maximum_${label}_scuff_kind`);
    this.constants.push([maximumKind, `uint256(ScuffKind.${this.lastKind})`]);

    return [
      `/// @dev Add all nested directives in ${label}`,
      `${pointerRef}.addScuffDirectives(directives, kindOffset + ${minimumKind}, ${positions});`
    ];
  }

  bytesDirectives() {
    this.directives.push(...this.scuffLength(`positions`));
    if (OPTIONS.bytes.setLowerBits && canScuffReferenceType(this.type)) {
      this.scuffKinds.push(`DirtyLowerBits`);
      this.directives.push(
        `uint256 len = ptr.length().readUint256();`,
        `uint256 bitOffset = (len % 32) * 8;`,
        `if (len > 0 && bitOffset != 0) {`,
        [
          `MemoryPointer end = ptr.unwrap().offset(32 + len);`,
          `directives.push(Scuff.lower(uint256(ScuffKind.DirtyLowerBits) + kindOffset, bitOffset, end, positions));`
        ],
        `}`
      );
    }
  }

  arrayDirectives(type: ArrayType) {
    if (type.isDynamicallySized) {
      this.directives.push(...this.scuffLength(`positions`));
    }
    const length = type.isDynamicallySized ? `ptr.length().readUint256()` : type.length;
    const memberDirectives = this.getMemberDirective(`element`, `i`, type.baseType, `pos`);
    if (memberDirectives.length > 0) {
      this.directives.push(
        `uint256 len = ${length};`,
        `for (uint256 i; i < len; i++) {`,
        `ScuffPositions pos = positions.push(i);`,
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
        ...this.getMemberDirective(member.labelFromParent!, ``, member, "positions")
      ],
      [] as StructuredText[]
    );
  }

  getMemberDirective(label: string, fnArgs: string, member: TypeNode, positions: string) {
    const headName = `${label}${member.isDynamicallyEncoded ? `Head` : ""}`;
    const directives: StructuredText[] = [];

    if (member.isDynamicallyEncoded) {
      if (canScuffReferenceType(member)) {
        directives.push(...this.scuffHead(label, `ptr.${headName}(${fnArgs})`, positions));
      }
    }

    if (member.isValueType && member.exactBits !== undefined && member.exactBits < 256) {
      const [dirtyBitsSide, dirtyBitsOffset] = member.leftAligned
        ? ([`lower`, member.exactBits] as const)
        : ([`upper`, 256 - member.exactBits] as const);
      const [maxSide, maxOffset] = member.leftAligned
        ? ([`upper`, member.exactBits] as const)
        : ([`lower`, 256 - member.exactBits] as const);

      if (OPTIONS.elementary.setDirtyBits || canScuffElementaryType(member, "setDirtyBits")) {
        directives.push(
          this.scuffValue(
            label,
            `ptr.${headName}(${fnArgs})`,
            dirtyBitsSide,
            dirtyBitsOffset,
            positions,
            "DirtyBits",
            `Add dirty ${dirtyBitsSide} bits to \`${label}\``
          )
        );
      }
      if (OPTIONS.elementary.setMax || canScuffElementaryType(member, "setMax")) {
        directives.push(
          this.scuffValue(
            label,
            `ptr.${headName}(${fnArgs})`,
            maxSide,
            maxOffset,
            positions,
            "MaxValue",
            `Set every bit in \`${label}\` to 1`
          )
        );
      }
    }

    if (member.isReferenceType) {
      const dataName = `${label}Data`;
      directives.push(this.subDirectives(label, `ptr.${dataName}(${fnArgs})`, member, positions));
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

  // if (member.isValueType && member.exactBits !== undefined && member.exactBits < 256) {
  //   const maxValue = (member as ValueType).max();

  //   if (maxValue && !member.leftAligned) {
  //     const overflowName = snakeCaseToPascalCase(`overflowed_${label}`);
  //     const overvlowValue = toHex(maxValue + BigInt(1));
  //     contract.addConstant(overflowName, overvlowValue);

  //     const overflowFn = snakeCaseToCamelCase(`overflow_${label}`);
  //     contract.addFunction(overflowFn, [
  //       `/// @dev Cause \`${label}\` to overflow`,
  //       `function ${overflowFn}(${parentPointerType} ptr) internal pure {`,
  //       [`${headName}(ptr).write(${overflowName});`],
  //       `}`
  //     ]);
  //   } else {
  //     const addDirtyBitsFn = snakeCaseToCamelCase(`addDirtyBitsTo_${label}`);
  //     const [dirtyBitsFn, offset] = member.leftAligned
  //       ? [`addDirtyBitsAfter`, member.exactBits]
  //       : [`addDirtyBitsBefore`, 256 - member.exactBits];
  //     contract.addFunction(addDirtyBitsFn, [
  //       `/// @dev Add dirty bits to \`${label}\``,
  //       `function ${addDirtyBitsFn}(${parentPointerType} ptr) internal pure {`,
  //       [`${headName}(ptr).${dirtyBitsFn}(${toHex(offset)});`],
  //       `}`
  //     ]);
  //   }
  // }
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

  library.addConstant(`FunctionName`, type.name, ConstantKind.String);

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
  /*     const locationString =
      location === DataLocation.Default || this.isValueType ? "" : location.toString();
    return [this.canonicalName, locationString, name].filter(Boolean).join(" "); */
  const writeParam = (member: TypeNode) => {
    const locationString = member.isValueType ? "" : "memory";
    return [member.canonicalName, locationString, `_${member.labelFromParent}`]
      .filter(Boolean)
      .join(" ");
  };
  const childParameters = type.parameters!.vMembers.map(writeParam);
  const inputArgs = "(" + childParameters.join(", ") + ")";
  // return "(" + childParameters.join(", ") + ")";
  // const inputArgs = type.parameters!.writeParameter(DataLocation.Memory);
  const parameters = [
    `"${type.signature(false)}"`,
    ...type.parameters!.vMembers.map((m) => `_${m.labelFromParent!}`)
  ];
  const deps = type.parameters!.vMembers.map(getTypeDep);
  const depDefs = deps
    .filter(Boolean)
    .map((d) => lookupDefinition(parentCtx.sourceUnit.requiredContext, d!))
    .filter(Boolean) as Array<EnumDefinition | StructDefinition>;
  if (depDefs.length > 0) {
    addDefinitionImports(library.sourceUnit, depDefs);
  }
  // for (const dep of depDefs) {
  //   if (dep) {
  //     const p = dep.getClosestParentByType(SourceUnit) as SourceUnit;
  //     library.addImports(p, []);
  //   }
  // }
  library.addFunction("encodeFunctionCall", [
    "/// @dev Encode function calldata",
    `function encodeFunctionCall${inputArgs} internal pure returns (bytes memory) {`,
    [`return abi.encodeWithSignature(${parameters.join(", ")});`],
    `}`
  ]);
  library.addFunction("fromArgs", [
    "/// @dev Encode function call from arguments",
    `function fromArgs${inputArgs} internal pure returns (${pointerName} ptrOut) {`,
    [
      `bytes memory data = encodeFunctionCall(${parameters.slice(1).join(", ")});`,
      `ptrOut = fromBytes(data);`
    ],
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
    type.isDynamicallySized ? `OneWord` : undefined,
    headComment
  );

  const headRef = type.isDynamicallySized ? `head(ptr)` : `ptr.unwrap()`;

  // const headOffsetMember = type.isDynamicallySized
  //   ? `head(ptr).offset(index * CalldataStride)`
  //   : `ptr.unwrap().offset(index * ${calldataStride})`;

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
    [`return ${headRef}.offset(index * ${calldataStride});`],
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
    const offset = type.baseType.isDynamicallyEncoded
      ? `elementHead(ptr, index).readUint256()`
      : `index * ${calldataStride}`;
    /*  const position = type.baseType.isDynamicallyEncoded
        ? `head`
        : `${headName}(ptr, index)`; */
    library.addFunction(dataName, [
      `/// @dev Resolve the \`${memberPointerType}\` pointing to the data buffer of \`arr[index]\``,
      `function ${dataName}(${pointerName} ptr, uint256 index) internal pure returns (${memberPointerType}) {`,
      [`return ${memberPointerType}Library.wrap(${headRef}.offset(${offset}));`],
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
    `OneWord`,
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

/**
 * Build files for scuff directives
 */
export function buildPointerFiles(
  helper: CompileHelper,
  primaryFileName: string,
  decoderFileName = primaryFileName.replace(".sol", "Pointers.sol"),
  outPath?: string,
  logger = new DebugLogger()
): { ctx: CodegenContext; functions: FunctionType[]; structs: StructType[] } {
  decoderFileName = primaryFileName.replace(path.basename(primaryFileName), "Index.sol");
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
  /* function getSelector(bytes memory data) pure returns (bytes4 selector) {
  assembly {
    selector := shr(224, mload(add(data, 0x04)))
  }
}
function getDirectivesForCalldata(bytes memory data) pure returns (ScuffDirective[] memory) {
  
} */
  ctx.addFunction(`getSelector`, [
    `/// @dev Get the selector from the first 4 bytes of the data`,
    `function getSelector(bytes memory data) pure returns (bytes4 selector) {`,
    [`assembly {`, [`selector := shl(224, mload(add(data, 0x04)))`], `}`],
    `}`
  ]);
  const libraryNames: string[] = [];
  [...structs, ...functions].map((type) => {
    logger.log(
      `Generating pointer library for ${
        type instanceof StructType ? type.identifier : type.signature(true)
      }...`
    );
    const { library, libraryName } = generateReferenceTypeLibrary(ctx, type, true);
    if (
      type instanceof FunctionType &&
      library.sourceUnit.getChildrenBySelector(
        (s) => s instanceof FunctionDefinition && s.name === "getScuffDirectivesForCalldata"
      ).length > 0 &&
      library.sourceUnit.getChildrenBySelector(
        (s) => s instanceof FunctionDefinition && s.name === "toKindString"
      ).length > 0
    ) {
      libraryNames.push(libraryName);
    }
  });
  ctx.addFunction(`getScuffDirectivesForCalldata`, [
    `/// @dev Get the directives for the given calldata`,
    `function getScuffDirectivesForCalldata(bytes memory data) pure returns (ScuffDirective[] memory) {`,
    [
      `bytes4 selector = getSelector(data);`,
      ...libraryNames.reduce(
        (prev, n) => [
          ...prev,
          `if (${n}.isFunction(selector)) {`,
          [`return ${n}.getScuffDirectivesForCalldata(data);`],
          `}`
        ],
        [] as StructuredText[]
      ),
      `revert("No matching function found");`
    ],
    `}`
  ]);

  // ctx.sourceUnit.
  ctx.addFunction(`toKindString`, [
    `function toKindString(bytes4 selector, uint256 k) pure returns (string memory) {`,
    [
      ...libraryNames.reduce(
        (prev, n) => [
          ...prev,
          `if (${n}.isFunction(selector)) {`,
          [`return ${n}.toKindString(k);`],
          `}`
        ],
        [] as StructuredText[]
      ),
      `revert("No matching function found");`
    ],
    `}`
  ]);
  ctx.addFunction(`getFunctionName`, [
    `function getFunctionName(bytes4 selector) pure returns (string memory) {`,
    [
      ...libraryNames.reduce(
        (prev, n) => [
          ...prev,
          `if (${n}.isFunction(selector)) {`,
          [`return ${n}.FunctionName;`],
          `}`
        ],
        [] as StructuredText[]
      ),
      `revert("No matching function found");`
    ],
    `}`
  ]);
  ctx.addFunction(`getScuffDescription`, [
    `function getScuffDescription(`,
    [`bytes4 selector,`, `ScuffDirective directive`],
    `) view returns (ScuffDescription memory description) {`,
    [
      `(`,
      [
        `uint256 kind,`,
        `ScuffSide side,`,
        `uint256 bitOffset,`,
        `ScuffPositions positions,`,
        `MemoryPointer pointer`
      ],
      `) = directive.decode();`,
      `description.pointer = MemoryPointer.unwrap(pointer);`,
      `description.originalValue = pointer.readBytes32();`,
      `description.positions = positions.toArray();`,
      `description.side = toSideString(side);`,
      `description.bitOffset = bitOffset;`,
      `description.kind = toKindString(selector, kind);`,
      `description.functionName = getFunctionName(selector);`
    ],

    `}`
  ]);

  ctx.applyPendingFunctions();
  ctx.applyPendingContracts();

  return { ctx, functions, structs };
}
