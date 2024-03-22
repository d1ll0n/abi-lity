import {
  ContractDefinition,
  ContractKind,
  DataLocation,
  FunctionStateMutability
} from "solc-typed-ast";
import {
  ArrayType,
  BytesType,
  ContractType,
  EnumType,
  FixedBytesType,
  IntegerType,
  StringType,
  StructType,
  TypeNode,
  ValueType
} from "../../ast";
import { BigNumber } from "@ethersproject/bignumber";
import { addCommaSeparators, StructuredText } from "../../utils";
import { WrappedContract, WrappedScope, WrappedSourceUnit } from "../ctx/contract_wrapper";
import { toPascalCase } from "../names";

const builtinSerializers = {
  bool: "serializeBool",
  uint256: "serializeUint256",
  int256: "serializeInt256",
  address: "serializeAddress",
  bytes32: "serializeBytes32",
  string: "serializeString",
  bytes: "serializeBytes",
  "bool[]": "serializeBoolArray",
  "uint256[]": "serializeUint256Array",
  "int256[]": "serializeInt256Array",
  "address[]": "serializeAddressArray",
  "bytes32[]": "serializeBytes32Array",
  "string[]": "serializeStringArray"
} as Record<string, string>;

export function getForgeJsonSerializeFunction(ctx: WrappedScope, type: TypeNode): string {
  const baseSignature = type.signatureInExternalFunction(true);
  const builtinName = builtinSerializers[baseSignature];
  if (type.isReferenceType) {
    getTypeBuilderLibrary(
      WrappedSourceUnit.getWrapper(ctx.helper, ctx.sourceUnit, ctx.outputPath),
      type
    );
  }
  if (builtinName) {
    const body = [`return LibJson.${builtinName}(value);`];
    return addSerializeFunction(ctx, type, body);
  }
  if (type instanceof ArrayType) {
    return getForgeSerializeArrayFunction(ctx, type);
  }
  if (type instanceof StructType) {
    return getForgeSerializeStructFunction(ctx, type);
  }
  if (type instanceof EnumType) {
    return getForgeSerializeEnumFunction(ctx, type);
  }
  if (type instanceof ValueType) {
    if (baseSignature.startsWith("int") || baseSignature.startsWith("uint")) {
      return getForgeJsonSerializeFunction(
        ctx,
        new IntegerType(256, baseSignature.startsWith("i"))
      );
    }
    if (baseSignature.startsWith("bytes")) {
      return getForgeJsonSerializeFunction(ctx, new FixedBytesType(32));
    }
  }
  throw Error(`Could not make serializer for type: ${type.pp()}`);
}

export function getForgeSerializeEnumFunction(ctx: WrappedScope, type: EnumType): string {
  const body: StructuredText<string> = [
    `string[${type.members.length}] memory members = [`,
    addCommaSeparators(type.members.map((m) => `"${m}"`)),
    "];",
    `uint256 index = uint256(value);`,
    `return members[index];`
  ];
  return addSerializeFunction(ctx, type, body);
}

function addSerializeFunction(ctx: WrappedScope, type: TypeNode, body: StructuredText<string>) {
  const name = `serialize${type.pascalCaseName}`;
  const inputs = `${type.writeParameter(DataLocation.Memory, "value")}`;
  const outputs = "string memory";
  const fn = ctx.addInternalFunction(name, inputs, outputs, body, FunctionStateMutability.Pure);
  const prefix = type.isReferenceType ? `` : "LibJson.";
  return `${prefix}${fn}`;
}

export function getForgeSerializeArrayFunction(ctx: WrappedScope, type: ArrayType): string {
  const baseSerialize = getForgeJsonSerializeFunction(ctx, type.baseType);
  const baseArg = type.baseType.writeParameter(DataLocation.Memory, "");
  const body: StructuredText[] = [
    `function(uint256[] memory, function(uint256) pure returns (string memory)) internal pure returns (string memory) _fn = LibJson.serializeArray;`,
    `function(${type.writeParameter(
      DataLocation.Memory,
      ""
    )}, function(${baseArg}) pure returns (string memory)) internal pure returns (string memory) fn;`,
    `assembly { fn := _fn }`,
    `return fn(value, ${baseSerialize});`
  ];
  return addSerializeFunction(ctx, type, body);
}

/*       '{"account":', data.account.serializeAddress(),
        ',"userBalance":', data.userBalance.serializeUint(),
        ',"someArray":', data.someArray.serializeArray(LibJson.serializeUint),
        '}' */

export function getForgeSerializeStructFunction(ctx: WrappedScope, struct: StructType): string {
  const segments: StructuredText[] = [];
  struct.children.forEach((child, i) => {
    const fn = getForgeJsonSerializeFunction(ctx, child);
    let ref = `value.${child.labelFromParent}`;
    if (child instanceof ContractType) {
      ref = `address(${ref})`;
    }
    const prefix = i === 0 ? "{" : ",";
    segments.push(`'${prefix}"${child.labelFromParent}":'`);
    segments.push(`${fn}(${ref})`);
  });
  segments.push("'}'");
  return addSerializeFunction(ctx, struct, [`return string.concat(`, segments.join(","), `);`]);
}

const toJsonValue = (n: bigint | BigNumber): string | number => {
  if (BigNumber.isBigNumber(n)) {
    n = n.toBigInt();
  }
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) {
    let str = n.toString(16);
    if (n < 0) {
      str = `-0x${str.slice(1)}`;
    } else {
      str = `0x${str}`;
    }
    return str;
  }
  return +n.toString(10);
};

const toJson = (obj: any): string =>
  JSON.stringify(obj, (k, v) => {
    if (typeof v === "bigint") {
      return toJsonValue(v);
    }
    return v;
  });

function getArrayTypeBuilderLibrary(ctx: WrappedSourceUnit, type: ArrayType) {
  const libraryName = `${type.pascalCaseName}Lib`;
  const library = ctx.addContract(libraryName, ContractKind.Library);

  if (type.baseType.isReferenceType) {
    addTypeLibraryAndUsingFor(ctx, library, type.baseType);
  }

  library.addInternalFunction(
    "empty",
    "",
    type.writeParameter(DataLocation.Memory, "arr"),
    [],
    FunctionStateMutability.Pure
  );
  library.addInternalFunction(
    "copy",
    type.writeParameter(DataLocation.Memory, "arr"),
    type.writeParameter(DataLocation.Memory, "newArr"),
    [`for (uint256 i = 0; i < arr.length; i++) {`, [`newArr[i] = arr[i];`], `}`],
    FunctionStateMutability.Pure
  );
  if (type.maxNestedReferenceTypes > 1) {
    library.addInternalFunction(
      `deepCopy`,
      type.writeParameter(DataLocation.Memory, "arr"),
      type.writeParameter(DataLocation.Memory, "newArr"),
      [
        `for (uint256 i = 0; i < arr.length; i++) {`,
        [`newArr[i] = ${getDeepCopyExpression(type.baseType, `arr[i]`)};`],
        `}`
      ],
      FunctionStateMutability.Pure
    );
  }

  const addWithElements = (size: number) => {
    console.log(`Adding withElements for ${type.canonicalName} with size ${size}`);
    const params = new Array(size)
      .fill(null)
      .map((_, j) => type.baseType.writeParameter(DataLocation.Memory, `element${j}`));
    const body = [];
    if (type.isDynamicallySized) {
      body.push(`arr = withCapacity(${size});`);
      body.push(...params.map((_, j) => `arr[${j}] = element${j};`));
    } else {
      body.push(
        `arr = new ${type.canonicalName}(`,
        params.map((_, i) => `element${i}`),
        `);`
      );
    }

    library.addInternalFunction(
      `with${size}Elements`,
      params.join(", "),
      type.writeParameter(DataLocation.Memory, "arr"),
      body,
      FunctionStateMutability.Pure
    );
  };

  if (type.isDynamicallySized) {
    library.addInternalFunction(
      "withCapacity",
      "uint256 capacity",
      type.writeParameter(DataLocation.Memory, "arr"),
      [`arr = new ${type.canonicalName}(capacity);`],
      FunctionStateMutability.Pure
    );

    library.addInternalFunction(
      "withCapacityAndElements",
      `uint256 capacity, ${type.writeParameter(DataLocation.Memory, "arr")}`,
      type.writeParameter(DataLocation.Memory, "newArr"),
      [
        `newArr = withCapacity(capacity);`,
        `uint256 len = arr.length > capacity ? capacity : arr.length;`,
        `for (uint256 i = 0; i < len; i++) {`,
        [`newArr[i] = arr[i];`],
        `}`
      ],
      FunctionStateMutability.Pure
    );

    for (let i = 1; i < 17; i++) {
      console.log(`adding elements ${i}`);
      addWithElements(i);
    }

    const addElementBody = [
      `uint256 len = arr.length;`,
      `newArr = withCapacityAndElements(len + 1, arr);`,
      `newArr[len] = element;`
    ];
    const inputs = [
      type.writeParameter(DataLocation.Memory, "arr"),
      type.baseType.writeParameter(DataLocation.Memory, "element")
    ].join(", ");

    library.addInternalFunction(
      `add`,
      inputs,
      type.writeParameter(DataLocation.Memory, "newArr"),
      addElementBody,
      FunctionStateMutability.Pure
    );
  } else {
    addWithElements(type.length as number);
  }
  return library;
}

const getDeepCopyExpression = (type: TypeNode, ref: string) => {
  if (type.isValueType) return ref;
  if (type.maxNestedReferenceTypes > 1) return `${ref}.deepCopy()`;
  return `${ref}.copy()`;
};

function getTypeBuilderLibrary(ctx: WrappedSourceUnit, type: TypeNode) {
  const libraryName = `${type.pascalCaseName}Lib`;
  // const sourceUnit = ctx.sourceUnit; //addSourceUnit(`${libraryName}.sol`);
  const library = ctx.sourceUnit
    .getChildrenByType(ContractDefinition)
    .filter((c) => c.name === libraryName)[0];
  if (library) {
    const wrapper = WrappedContract.getWrapperFromContract(ctx.helper, library, ctx.outputPath);
    return wrapper;
  }
  // ctx = WrappedSourceUnit.getWrapper(ctx.helper, sourceUnit);
  if (type instanceof ArrayType) {
    return getArrayTypeBuilderLibrary(ctx, type);
  }
  if (type instanceof StructType) {
    return getStructTypeBuilderLibrary(ctx, type);
  }
  if (type instanceof StringType) {
    return getStringBuilderLibrary(ctx, type);
  }
  if (type instanceof BytesType) {
    return getBytesBuilderLibrary(ctx, type);
  }
  throw new Error(`Type ${type.canonicalName} is not supported`);
}

function getBytesBuilderLibrary(ctx: WrappedSourceUnit, type: BytesType) {
  const libraryName = `${type.pascalCaseName}Lib`;
  const library = ctx.addContract(libraryName, ContractKind.Library);
  library.addInternalFunction(
    `copy`,
    type.writeParameter(DataLocation.Memory, "obj"),
    type.writeParameter(DataLocation.Memory, "result"),
    [`result = obj;`],
    FunctionStateMutability.Pure
  );
  return library;
}
function getStringBuilderLibrary(ctx: WrappedSourceUnit, type: StringType) {
  const libraryName = `${type.pascalCaseName}Lib`;
  const library = ctx.addContract(libraryName, ContractKind.Library);
  library.addInternalFunction(
    `copy`,
    type.writeParameter(DataLocation.Memory, "obj"),
    type.writeParameter(DataLocation.Memory, "result"),
    [`result = obj;`],
    FunctionStateMutability.Pure
  );
  return library;
}

function addTypeLibraryAndUsingFor(
  ctx: WrappedSourceUnit,
  library: WrappedContract,
  child: TypeNode
) {
  const childLibraryName = `${child.pascalCaseName}Lib`;
  const childLibrary = getTypeBuilderLibrary(ctx, child);
  /*   library.addImports(childLibrary.sourceUnit, [
      {
        foreign: ctx.factory.makeIdentifierFor(childLibrary.scope as ContractDefinition),
        local: null
      }
    ]); */
  library.addCustomTypeUsingForDirective("*", ctx.factory.makeIdentifierPath(childLibraryName, -1));
}

function getStructTypeBuilderLibrary(ctx: WrappedSourceUnit, type: StructType) {
  const libraryName = `${type.pascalCaseName}Lib`;
  const library = ctx.addContract(libraryName, ContractKind.Library);
  // ctx.helper.sourceUnits.find(su => )
  // library.addDependencyImports;
  library.addCustomTypeUsingForDirective("*", ctx.factory.makeIdentifierPath(libraryName, -1));
  for (const child of type.children) {
    if (child.isReferenceType) {
      addTypeLibraryAndUsingFor(ctx, library, child);
    }
  }
  library.addInternalFunction(
    "empty",
    "",
    type.writeParameter(DataLocation.Memory, "result"),
    [],
    FunctionStateMutability.Pure
  );

  // add withProperty functions
  for (const child of type.children) {
    const inputs = [
      type.writeParameter(DataLocation.Memory, "obj"),
      child.writeParameter(DataLocation.Memory)
    ];
    library.addInternalFunction(
      `with${toPascalCase(child.labelFromParent as string)}`,
      inputs.join(", "),
      type.writeParameter(DataLocation.Memory, "result"),
      [`result = obj;`, `result.${child.labelFromParent} = ${child.labelFromParent};`],
      FunctionStateMutability.Pure
    );
  }

  {
    // add copy function
    const addFields = type.children.map(
      (child) =>
        `.with${toPascalCase(child.labelFromParent as string)}(obj.${child.labelFromParent})`
    );
    const copyBody = [`result = empty()${addFields.join("")};`];
    library.addInternalFunction(
      `copy`,
      type.writeParameter(DataLocation.Memory, "obj"),
      type.writeParameter(DataLocation.Memory, "result"),
      copyBody,
      FunctionStateMutability.Pure
    );
  }

  {
    // Add deepCopy function
    if (type.maxNestedReferenceTypes > 1) {
      const segments = [];
      for (const child of type.children) {
        segments.push(
          `.with${toPascalCase(child.labelFromParent as string)}(${getDeepCopyExpression(
            child,
            `obj.${child.labelFromParent}`
          )})`
        );
      }

      const deepCopyBody = [`result = empty()${segments.join("")};`];
      library.addInternalFunction(
        `deepCopy`,
        type.writeParameter(DataLocation.Memory, "obj"),
        type.writeParameter(DataLocation.Memory, "result"),
        deepCopyBody,
        FunctionStateMutability.Pure
      );
    }
  }
  return library;
}

// function getForgeDataBuildStatement(type: TypeNode, value: any): StructuredText {
//   if (type instanceof ValueType) {
//     assert(typeof value === "string", "IntegerType value must be a string");
//     if (type instanceof EnumType) {
//       value = `${type.name}.${type.members[+value]}`;
//     }
//     return `${type.writeParameter(DataLocation.Memory)} = ${value};`;
//   }
//   if (type instanceof ArrayType) {
//     assert(Array.isArray(value), "ArrayType value must be an array");
//     const values = value.map((v) => getForgeDataBuildStatement(type.baseType, v));
//     if (type.isDynamicallySized) {
//       return [`${type.writeParameter(DataLocation.Memory)} = [`, addCommaSeparators(values), "];"];
//     }
//     const body = [
//       `${type.writeParameter(DataLocation.Memory)} = new ${type.canonicalName}(${values.length});`,

//     ];
//     values.forEach((v, i) => {
//       body.push(`${type.writeParameter(DataLocation.Memory, `[${i}]`)} = ${v};`)
//     });
//     values.map((v, i) => `${type.labelFromParent}[${i}] = ${};`
//   }
//   if (type instanceof StructType) {
//     assert(typeof value === "object", "StructType value must be an object");
//     const values = type.children.map((c) =>
//       getForgeDataBuildStatement(c, value[c.labelFromParent as string])
//     );
//   }
//   return [];
// }

// const makeTestFor = (ctx: WrappedScope, type: TypeNode) => {
//   const data = getDefaultForType(type, 3);
//   const json = toJson(data);
//   const jsonString = `"${json.replace(/"/g, '\\"')}"`;
//   const serializeFn = `serialize${type.pascalCaseName}`;
//   const name = `testSerialize${type.pascalCaseName}`;
//   const body = [
//     `string memory expected = ${jsonString};`,
//     `string memory actual = ${serializeFn}(value);`,
//     `assertEq(expected, actual);`
//   ];
//   //ctx.
// };
