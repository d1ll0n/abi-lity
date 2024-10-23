import {
  ArrayType,
  DefaultVisitor,
  EnumType,
  FixedBytesType,
  IntegerType,
  StructType,
  TypeNode,
  UABIType,
  ValueType
} from "../../../../ast";
import { addCommaSeparators, coerceArray, StructuredText } from "../../../../utils";
import { DataLocation, FunctionStateMutability, Mapping, StructDefinition } from "solc-typed-ast";
import { structDefinitionToTypeNode } from "../../../../readers";
import { WrappedScope, WrappedSourceUnit } from "../../../../codegen/ctx/contract_wrapper";
import NameGen from "../../../../codegen/names";
import { CompileHelper } from "../../../../utils/compile_utils/compile_helper";

export type JsonSerializerOptions = {
  serializerFileName?: string;
};

export function generateJsonSerializers(
  helper: CompileHelper,
  fileName: string,
  options: JsonSerializerOptions = {},
  struct?: string | string[]
): void {
  const serializerFileName =
    options.serializerFileName ?? fileName.replace(".sol", "Serializers.sol");
  const ctx: WrappedScope = WrappedSourceUnit.getWrapper(helper, serializerFileName);
  const sourceUnit = helper.getSourceUnit(fileName);
  ctx.addImports(sourceUnit);
  ctx.addSolidityLibrary("JsonLib");
  let structDefinitions = sourceUnit
    .getChildrenByType(StructDefinition)
    .filter((struct) => struct.getChildrenByType(Mapping).length === 0);
  if (struct) {
    structDefinitions = structDefinitions.filter((s) => coerceArray(struct).includes(s.name));
  }

  const structs = structDefinitions.map(s => structDefinitionToTypeNode(s));
  for (const struct of structs) {
    getJsonSerializerFunction(ctx, struct);
  }
  ctx.applyPendingFunctions();
}

const builtinSerializers = {
  bool: "JsonLib.serializeBool",
  uint256: "JsonLib.serializeUint",
  int256: "JsonLib.serializeInt",
  address: "JsonLib.serializeAddress",
  bytes32: "JsonLib.serializeBytes32",
  string: "JsonLib.serializeString",
  bytes: "JsonLib.serializeBytes"
} as Record<string, string>;

export const VisitorByScope: WeakMap<WrappedScope, JsonSerializer> = new Map();

export function getJsonSerializerFunction(ctx: WrappedScope, node: TypeNode): string {
  const visitor = JsonSerializer.getVisitor(ctx);
  return visitor.accept(node);
}

export class JsonSerializer extends DefaultVisitor {
  existingTypeFunctions: Map<string, string> = new Map();

  constructor(private ctx: WrappedScope) {
    super();
    VisitorByScope.set(ctx, this);
  }

  static getVisitor(ctx: WrappedScope): JsonSerializer {
    let visitor = VisitorByScope.get(ctx);
    if (!visitor) {
      visitor = new JsonSerializer(ctx);
    }
    return visitor;
  }

  protected _shouldSkipVisitWith(type: TypeNode): string | undefined {
    return (
      this.existingTypeFunctions.get(type.identifier) ||
      builtinSerializers[type.signatureInExternalFunction(true)]
    );
  }

  get defaultReturnValue(): any {
    throw new Error("No default decoder.");
  }

  protected _afterVisit<T extends UABIType>(_type: T, result: any): string {
    this.existingTypeFunctions.set(_type.identifier, result);
    return result;
  }

  addSerializeFunction(type: TypeNode, body: StructuredText, comment?: StructuredText): string {
    const inputParam = type.writeParameter(DataLocation.Memory, "value");
    return this.ctx.addInternalFunction(
      NameGen.serialize(type),
      inputParam,
      `string memory output`,
      body,
      FunctionStateMutability.Pure,
      comment
    );
  }

  visitArray(type: ArrayType): string {
    const baseFn = this.visit(type.baseType);
    let body: StructuredText<string> = [];
    if (type.isDynamicallySized) {
      body = [
        `output = '[';`,
        `uint256 lastIndex = value.length - 1;`,
        `for (uint256 i = 0; i < lastIndex; i++) {`,
        [`output = string.concat(output, ${baseFn}(value[i]), ',');`],
        `}`,
        `output = string.concat(output, ${baseFn}(value[lastIndex]), ']');`
      ];
    } else {
      body = [
        `output = string.concat(`,
        [
          `"[", `,
          ...new Array(type.length as number)
            .fill(null)
            .map((_, i) => `${baseFn}(value[${i}]), ",",`),
          `"]"`
        ],
        ")"
      ];
    }
    return this.addSerializeFunction(type, body);
  }

  visitValueType(type: ValueType): string {
    const baseSignature = type.signatureInExternalFunction(true);
    if (baseSignature.startsWith("int") || baseSignature.startsWith("uint")) {
      return this.visit(new IntegerType(256, baseSignature.startsWith("i")));
    }
    if (baseSignature.startsWith("bytes")) {
      return this.visit(new FixedBytesType(32));
    }
    throw Error(`Could not make serializer for type: ${type.pp()}`);
  }

  visitEnum(type: EnumType): string {
    const body: StructuredText<string> = [
      `string[${type.members.length}] memory members = [`,
      addCommaSeparators(type.members.map((m) => `"${m}"`)),
      "];",
      `uint256 index = uint256(value);`,
      `return JsonLib.serializeString(objectKey, valueKey, members[index]);`
    ];
    return this.addSerializeFunction(type, body);
  }

  visitStruct(type: StructType): string {
    const segments = [
      `"{"`,
      ...type.children.map((m, i) => {
        const fn = this.visit(m);
        const label = m.labelFromParent;
        const isLast = i === type.children.length - 1;
        return `JsonLib.serializeKeyValuePair("${label}", ${fn}(value.${label}), ${isLast})`;
      }),
      `"}"`
    ];

    const body = [`output = string.concat(`, addCommaSeparators(segments), `);`];
    return this.addSerializeFunction(type, body);
  }
}
