import {
  ContractDefinition,
  ContractKind,
  DataLocation,
  FunctionStateMutability,
  assert
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
import { addCommaSeparators, getDefaultForType, StructuredText } from "../../utils";
import { WrappedContract, WrappedScope, WrappedSourceUnit } from "../ctx/contract_wrapper";
import { toPascalCase } from "../names";

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
