import {
  AddressType,
  ArrayType,
  BoolType,
  EnumType,
  FixedBytesType,
  IntegerType,
  StructType,
  TupleLikeType,
  TypeNode,
  ValueType
} from "../../ast";
import { addCommaSeparators, StructuredText } from "../../utils";
import { CodegenContext } from "../utils";

const builtinSerializers = {
  bool: "serializeBool",
  uint256: "serializeUint",
  int256: "serializeInt",
  address: "serializeAddress",
  bytes32: "serializeBytes32",
  string: "serializeString",
  bytes: "serializeBytes",
  "bool[]": "serializeBool",
  "uint256[]": "serializeUint",
  "int256[]": "serializeInt",
  "address[]": "serializeAddress",
  "bytes32[]": "serializeBytes32",
  "string[]": "serializeString"
} as Record<string, string>;

export function getForgeJsonSerializeFunction(ctx: CodegenContext, type: TypeNode): string {
  const baseSignature = type.signatureInExternalFunction(true);
  const builtinName = builtinSerializers[baseSignature];
  if (builtinName) {
    const body = [`return vm.${builtinName}(objectKey, valueKey, value);`];
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

function sizeOfSerializedType(type: TypeNode): number | undefined {
  if (type instanceof AddressType) return 8; // 4 bytes per addr
  if (type instanceof IntegerType) return 64;
  if (type instanceof BoolType) return 5;
  if (type instanceof EnumType) {
    return Math.max(...type.members.map((m) => m.length));
  }
  if (type instanceof FixedBytesType) return type.size;
  if (type instanceof ArrayType) {
    if (type.length !== undefined) {
      const baseSize = sizeOfSerializedType(type.baseType);
      return baseSize && baseSize * type.length;
    }
    return undefined;
  }
  if (type instanceof TupleLikeType) {
    return type.vMembers.reduce((sum: number | undefined, member) => {
      const size = sizeOfSerializedType(member);
      return sum && size ? size + sum : undefined;
    }, 2);
  }
  throw Error(`Unimplemented: sizeof serialized type ${type.pp()}`);
}

/*

function withKey()
using { length } for string;
function addToLine() 
*/

/*
uint256[] = [0, 1, 2, 3, 4, 5];



library ToString {
  uint256 internal constant LABEL_STORAGE_SLOT = uint256(keccak256("labels"));

  function getLabels() internal view returns (
    mapping(address => string) storage labels
  ) {
    assembly { labels.slot := LABELS_STORAGE_SLOT }
  }

  /// First 4 bytes of address for logs
  function toString(address a) internal view returns (string memory) {
    mapping(address => string) storage labels = getLabels();
    string storage label = labels[a];
    if (label.length > 0) return label;
    return (uint256(a) >> 128).toHexString();
  }

struct ABC {
  uint256 x;
  uint256 y;
  0x61 = a
  0x7a = z
}

*/

export function getForgeSerializeEnumFunction(ctx: CodegenContext, type: EnumType): string {
  // const baseSerialize = getForgeJsonSerializeFunction(ctx, type);
  const body: StructuredText<string> = [
    `string[${type.members.length}] memory members = [`,
    addCommaSeparators(type.members.map((m) => `"${m}"`)),
    "];",
    `uint256 index = uint256(value);`,
    `return vm.serializeString(objectKey, valueKey, members[index]);`
  ];
  return addSerializeFunction(ctx, type, body);
}

// const randomId

function addSerializeFunction(ctx: CodegenContext, type: TypeNode, body: StructuredText<string>) {
  const baseSignature = type.signatureInExternalFunction(true);
  const typeWithLocation = type.isReferenceType ? `${baseSignature} memory` : baseSignature;
  const name = `tojson${type.pascalCaseName}`;
  const code = [
    `function ${name}(string memory objectKey, string memory valueKey, ${typeWithLocation} value) returns (string memory) {`,
    body,
    "}"
  ];
  return ctx.addFunction(name, code);
}

export function getForgeSerializeArrayFunction(ctx: CodegenContext, type: ArrayType): string {
  const baseSerialize = getForgeJsonSerializeFunction(ctx, type.baseType);
  const body = [
    `string memory obj = string.concat(objectKey, valueKey);`,
    `uint256 length = value.length;`,
    `string memory out;`, //${type.signatureInExternalFunction(true)}
    `for (uint256 i; i < length; i++) {`,
    [`out = ${baseSerialize}(obj, string.concat("element", vm.toString(i)), value[i]);`],
    `}`,
    `return vm.serializeString(objectKey, valueKey, out);`
  ];
  return addSerializeFunction(ctx, type, body);
}

export function getForgeSerializeStructFunction(ctx: CodegenContext, struct: StructType): string {
  const body: StructuredText<string> = [`string memory obj = string.concat(objectKey, valueKey);`];
  struct.children.forEach((child, i) => {
    const fn = getForgeJsonSerializeFunction(ctx, child);
    const statement = `${fn}(obj, "${child.labelFromParent}", value.${child.labelFromParent});`;
    if (i === struct.children.length - 1) {
      body.push(`string memory finalJson = ${statement}`);
      body.push(`return vm.serializeString(objectKey, valueKey, finalJson);`);
    } else {
      body.push(statement);
    }
  });
  return addSerializeFunction(ctx, struct, body);
}
