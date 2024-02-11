// import {
//   ContractKind,
//   DataLocation,
//   EnumDefinition,
//   FunctionDefinition,
//   FunctionStateMutability,
//   StructDefinition,
//   assert,
//   coerceArray
// } from "solc-typed-ast";
// import {
//   AddressType,
//   ArrayType,
//   BoolType,
//   DefaultVisitor,
//   EnumType,
//   FixedBytesType,
//   IntegerType,
//   StructType,
//   TupleLikeType,
//   TypeNode,
//   UABIType,
//   ValueType
// } from "../../ast";
// import {
//   addCommaSeparators,
//   addTypeImport,
//   getDefaultForType,
//   StructuredText,
//   toHex
// } from "../../utils";
// import { WrappedContract, WrappedScope, WrappedSourceUnit } from "../ctx/contract_wrapper";
// import NameGen from "../names";
// import { TestCodeHelper } from "../../../test/test-helper";
// import { astDefinitionToTypeNode } from "../../readers";
// import path from "path";
// import { getAddress } from "@ethersproject/address";
// import { buildExternalWrapper } from "../wrappers";
// import { CompilerOutputConfigs } from "../../utils/compile_utils/solc";
// import { TestDeployment, getTestDeployment } from "../../test_utils";
// import { CompileHelper } from "../../utils/compile_utils/compile_helper";

// const builtinSerializers = {
//   bool: "JsonLib.serializeBool",
//   uint256: "JsonLib.serializeUint",
//   int256: "JsonLib.serializeInt",
//   address: "JsonLib.serializeAddress",
//   bytes32: "JsonLib.serializeBytes32",
//   string: "JsonLib.serializeString",
//   bytes: "JsonLib.serializeBytes"
// } as Record<string, string>;

// export const VisitorByScope: WeakMap<WrappedScope, SerializeVisitor> = new Map();

// export function getSerializeFunction(ctx: WrappedScope, node: TypeNode): string {
//   const visitor = SerializeVisitor.getVisitor(ctx);
//   return visitor.accept(node);
// }

// class SerializeVisitor extends DefaultVisitor {
//   existingTypeFunctions: Map<string, string> = new Map();

//   constructor(private ctx: WrappedScope) {
//     super();
//     VisitorByScope.set(ctx, this);
//   }

//   static getVisitor(ctx: WrappedScope): SerializeVisitor {
//     let visitor = VisitorByScope.get(ctx);
//     if (!visitor) {
//       visitor = new SerializeVisitor(ctx);
//     }
//     return visitor;
//   }

//   protected _shouldSkipVisitWith(type: TypeNode): string | undefined {
//     return (
//       this.existingTypeFunctions.get(type.identifier) ||
//       builtinSerializers[type.signatureInExternalFunction(true)]
//     );
//   }

//   get defaultReturnValue(): any {
//     throw new Error("No default decoder.");
//   }

//   protected _afterVisit<T extends UABIType>(_type: T, result: any): string {
//     this.existingTypeFunctions.set(_type.identifier, result);
//     return result;
//   }

//   addSerializeFunction(type: TypeNode, body: StructuredText, comment?: StructuredText): string {
//     const inputParam = type.writeParameter(DataLocation.Memory, "value");
//     return this.ctx.addInternalFunction(
//       NameGen.serialize(type),
//       inputParam,
//       `string memory output`,
//       body,
//       FunctionStateMutability.Pure,
//       comment
//     );
//   }

//   visitArray(type: ArrayType) {
//     const baseFn = this.visit(type.baseType);
//     let body: StructuredText<string> = [];
//     if (type.isDynamicallySized) {
//       body = [
//         `output = '[';`,
//         `uint256 lastIndex = value.length - 1;`,
//         `for (uint256 i = 0; i < lastIndex; i++) {`,
//         [`output = string.concat(output, ${baseFn}(value[i]), ',');`],
//         `}`,
//         `output = string.concat(output, ${baseFn}(value[lastIndex]), ']');`
//       ];
//     } else {
//       body = [
//         `output = string.concat(`,
//         [
//           `"[", `,
//           ...new Array(type.length as number)
//             .fill(null)
//             .map((_, i) => `${baseFn}(value[${i}]), ",",`),
//           `"]"`
//         ],
//         ")"
//       ];
//     }
//     return this.addSerializeFunction(type, body);
//   }

//   visitValueType(type: ValueType) {
//     const baseSignature = type.signatureInExternalFunction(true);
//     if (baseSignature.startsWith("int") || baseSignature.startsWith("uint")) {
//       return this.visit(new IntegerType(256, baseSignature.startsWith("i")));
//     }
//     if (baseSignature.startsWith("bytes")) {
//       return this.visit(new FixedBytesType(32));
//     }
//   }

//   visitEnum(type: EnumType) {
//     const body: StructuredText<string> = [
//       `string[${type.members.length}] memory members = [`,
//       addCommaSeparators(type.members.map((m) => `"${m}"`)),
//       "];",
//       `uint256 index = uint256(value);`,
//       `return JsonLib.serializeString(objectKey, valueKey, members[index]);`
//     ];
//     return this.addSerializeFunction(type, body);
//   }

//   visitStruct(type: StructType) {
//     const segments = [
//       `"{"`,
//       ...type.children.map((m, i) => {
//         const fn = this.visit(m);
//         const label = m.labelFromParent;
//         const isLast = i === type.children.length - 1;
//         return `JsonLib.serializeKeyValuePair("${label}", ${fn}(value.${label}), ${isLast})`;
//       }),
//       `"}"`
//     ];

//     const body = [`output = string.concat(`, addCommaSeparators(segments), `);`];
//     return this.addSerializeFunction(type, body);
//   }
// }

// function serializeValue(type: TypeNode, value: any): any {
//   if (type instanceof AddressType) return getAddress(value);
//   if (type instanceof IntegerType) {
//     if (
//       (value as bigint) > BigInt(Number.MAX_SAFE_INTEGER) ||
//       (value as bigint) < BigInt(Number.MIN_SAFE_INTEGER)
//     ) {
//       return toHex(value);
//     }
//     return +value.toString();
//   }
//   if (type instanceof BoolType) {
//     return value as boolean;
//   }
//   if (type instanceof EnumType) {
//     return type.members[value as number];
//   }
//   if (type instanceof FixedBytesType) {
//     return toHex(value);
//   }
//   if (type instanceof ArrayType) {
//     return (value as any[]).map((v) => serializeValue(type.baseType, v));
//   }
//   if (type instanceof StructType) {
//     const obj: Record<string, any> = {};
//     for (const member of type.children) {
//       obj[member.labelFromParent as string] = serializeValue(
//         member,
//         value[member.labelFromParent as string]
//       );
//     }
//     return obj;
//   }
//   throw Error(`Unimplemented: sizeof serialized type ${type.pp()}`);
// }

// async function testTypeSerializer(deployment: TestDeployment, type: TypeNode) {
//   const name = NameGen.serialize(type);
//   const value = getDefaultForType(type, 1);
//   const result = await deployment.call(name, value);
//   const expectedResult = JSON.stringify(serializeValue(type, value));
//   const actualResult = result.returnData[0];
//   if (actualResult !== expectedResult) {
//     console.log(
//       `Expected:\n(${typeof expectedResult}) ${expectedResult}\nGot:\n(${typeof actualResult})${actualResult}`
//     );
//     throw Error(`Got bad result for ${type.identifier}`);
//   } else {
//     console.log(`Got expected result for ${type.identifier}`);
//   }
// }

// type JsonSerializerOptions = {
//   outputFileName?: string;
//   outputToLibrary?: boolean;
// };

// export function generateSerializers(
//   helper: CompileHelper,
//   definitions: StructDefinition | EnumDefinition | Array<StructDefinition | EnumDefinition>,
//   options: JsonSerializerOptions = {}
// ): WrappedScope {
//   definitions = coerceArray(definitions);
//   const coderCtx = WrappedSourceUnit.getWrapper(
//     helper,
//     options.outputFileName ?? `JsonEncoder.sol`
//   );
//   coderCtx.addSolidityLibrary("JsonLib");
//   for (const def of definitions) {
//     addTypeImport(coderCtx.scope, def);
//   }
//   const ctx = options.outputToLibrary
//     ? coderCtx.addContract("JsonEncoder", ContractKind.Library, [])
//     : coderCtx;
//   // @todo fix exported type of astDefinitionToTypeNode
//   const types = definitions.map((def) => astDefinitionToTypeNode(def as any)) as TypeNode[];
//   console.log(`Generating serializers for ${types.length} types`);
//   types.map((type) => getSerializeFunction(ctx, type));

//   coderCtx.applyPendingFunctions();
//   return ctx;
// }

// export async function testSerializers(coderCtx: WrappedScope): Promise<void> {
//   if (coderCtx instanceof WrappedContract) {
//     coderCtx = WrappedSourceUnit.getWrapper(coderCtx.helper, coderCtx.sourceUnit);
//   }
//   const fns = coderCtx.scope.getChildrenByType(FunctionDefinition);
//   console.log(`Generating wrapper for ${fns.length} fns`);
//   const testCtx = WrappedSourceUnit.getWrapper(coderCtx.helper, "ExternalWrapper.sol");
//   buildExternalWrapper(testCtx as WrappedSourceUnit, fns);
//   coderCtx.helper.recompile({ outputs: CompilerOutputConfigs.TESTS });

//   const contract = coderCtx.helper
//     .getContractsForFile("ExternalWrapper.sol")
//     .find((c) => c.name === "ExternalWrapper");
//   assert(contract !== undefined, "Could not find ExternalWrapper contract");
//   const deployment = await getTestDeployment(contract.runtimeCode, contract.abi, contract.name);
//   console.log(`Testing ${deployment.types.functions.length} functions`);
//   for (const fn of deployment.types.functions) {
//     assert(
//       fn.parameters?.vMembers.length === 1,
//       "Expected one parameter in serialize function " + fn.name
//     );
//     const type = fn.parameters.vMembers[0];
//     await testTypeSerializer(deployment, type);
//   }
// }

// async function test() {
//   const helper = await TestCodeHelper.fromCode(
//     `struct Item { uint256 x; uint40 y; bool isValue; }\nstruct Data {Item item; Item[] additionalItems;}`
//   );
//   const struct = helper.getStruct("Data");
//   // const type = structDefinitionToTypeNode(struct);
//   // const primaryCtx = helper.ctx;
//   const ctx = generateSerializers(helper.helper, struct, { outputToLibrary: true });
//   helper.helper.writeFilesTo(path.join(__dirname, "sample"));
//   await testSerializers(ctx);
//   /*   const data = getDefaultForType(type, 1);

//   const coderCtx = WrappedSourceUnit.getWrapper(primaryCtx.helper, `JsonEncoder.sol`);
//   coderCtx.addSolidityLibrary("JsonLib");
//   coderCtx.addImports(primaryCtx.sourceUnit, []);
//   getSerializeFunction(coderCtx, type);
//   coderCtx.applyPendingFunctions();
//   const fns = coderCtx.scope.getChildrenByType(FunctionDefinition);
//   buildExternalWrapper(coderCtx, fns);
//   coderCtx.helper.recompile({ outputs: CompilerOutputConfigs.TESTS });
//   helper.helper.writeFilesTo(path.join(__dirname, "sample")); */
// }
// test();
// // export function getForgeJsonSerializeFunction(ctx: CodegenContext, type: TypeNode): string {
// //   const baseSignature = type.signatureInExternalFunction(true);
// //   const builtinName = builtinSerializers[baseSignature];
// //   if (builtinName) {
// //     const body = [`return ${builtinName}(objectKey, valueKey, value);`];
// //     return addSerializeFunction(ctx, type, body);
// //   }
// //   if (type instanceof ArrayType) {
// //     return getForgeSerializeArrayFunction(ctx, type);
// //   }
// //   if (type instanceof StructType) {
// //     return getForgeSerializeStructFunction(ctx, type);
// //   }
// //   if (type instanceof EnumType) {
// //     return getForgeSerializeEnumFunction(ctx, type);
// //   }
// //   if (type instanceof ValueType) {
// //     if (baseSignature.startsWith("int") || baseSignature.startsWith("uint")) {
// //       return getForgeJsonSerializeFunction(
// //         ctx,
// //         new IntegerType(256, baseSignature.startsWith("i"))
// //       );
// //     }
// //     if (baseSignature.startsWith("bytes")) {
// //       return getForgeJsonSerializeFunction(ctx, new FixedBytesType(32));
// //     }
// //   }
// //   throw Error(`Could not make serializer for type: ${type.pp()}`);
// // }

// function sizeOfSerializedType(type: TypeNode): number | undefined {
//   if (type instanceof AddressType) return 8; // 4 bytes per addr
//   if (type instanceof IntegerType) return 64;
//   if (type instanceof BoolType) return 5;
//   if (type instanceof EnumType) {
//     return Math.max(...type.members.map((m) => m.length));
//   }
//   if (type instanceof FixedBytesType) return type.size;
//   if (type instanceof ArrayType) {
//     if (type.length !== undefined) {
//       const baseSize = sizeOfSerializedType(type.baseType);
//       return baseSize && baseSize * type.length;
//     }
//     return undefined;
//   }
//   if (type instanceof TupleLikeType) {
//     return type.vMembers.reduce((sum: number | undefined, member) => {
//       const size = sizeOfSerializedType(member);
//       return sum && size ? size + sum : undefined;
//     }, 2);
//   }
//   throw Error(`Unimplemented: sizeof serialized type ${type.pp()}`);
// }

// /*

// function withKey()
// using { length } for string;
// function addToLine()
// */

// /*
// uint256[] = [0, 1, 2, 3, 4, 5];

// library ToString {
//   uint256 internal constant LABEL_STORAGE_SLOT = uint256(keccak256("labels"));

//   function getLabels() internal view returns (
//     mapping(address => string) storage labels
//   ) {
//     assembly { labels.slot := LABELS_STORAGE_SLOT }
//   }

//   /// First 4 bytes of address for logs
//   function toString(address a) internal view returns (string memory) {
//     mapping(address => string) storage labels = getLabels();
//     string storage label = labels[a];
//     if (label.length > 0) return label;
//     return (uint256(a) >> 128).toHexString();
//   }

// struct ABC {
//   uint256 x;
//   uint256 y;
//   0x61 = a
//   0x7a = z
// }

// */

// // export function getForgeSerializeEnumFunction(ctx: CodegenContext, type: EnumType): string {
// //   // const baseSerialize = getForgeJsonSerializeFunction(ctx, type);
// //   const body: StructuredText<string> = [
// //     `string[${type.members.length}] memory members = [`,
// //     addCommaSeparators(type.members.map((m) => `"${m}"`)),
// //     "];",
// //     `uint256 index = uint256(value);`,
// //     `return vm.serializeString(objectKey, valueKey, members[index]);`
// //   ];
// //   return addSerializeFunction(ctx, type, body);
// // }

// // // const randomId

// // function addSerializeFunction(ctx: CodegenContext, type: TypeNode, body: StructuredText<string>) {
// //   const baseSignature = type.signatureInExternalFunction(true);
// //   const typeWithLocation = type.isReferenceType ? `${baseSignature} memory` : baseSignature;
// //   const name = `tojson${type.pascalCaseName}`;
// //   const code = [
// //     `function ${name}(string memory objectKey, string memory valueKey, ${typeWithLocation} value) returns (string memory) {`,
// //     body,
// //     "}"
// //   ];
// //   return ctx.addFunction(name, code);
// // }

// // export function getForgeSerializeArrayFunction(ctx: CodegenContext, type: ArrayType): string {
// //   const baseSerialize = getForgeJsonSerializeFunction(ctx, type.baseType);
// //   const body = [
// //     `string memory obj = string.concat(objectKey, valueKey);`,
// //     `uint256 length = value.length;`,
// //     `string memory out;`, //${type.signatureInExternalFunction(true)}
// //     `for (uint256 i; i < length; i++) {`,
// //     [`out = ${baseSerialize}(obj, string.concat("element", vm.toString(i)), value[i]);`],
// //     `}`,
// //     `return vm.serializeString(objectKey, valueKey, out);`
// //   ];
// //   return addSerializeFunction(ctx, type, body);
// // }

// // export function getForgeSerializeStructFunction(ctx: CodegenContext, struct: StructType): string {
// //   const body: StructuredText<string> = [];
// //   const memberSegments = struct.children.map((m, i) => {
// //     const fn = getForgeJsonSerializeFunction(ctx, m);
// //     const label = m.labelFromParent;
// //     const isLast = i === struct.children.length - 1;
// //     return `serializeKeyValuePair("${label}", ${fn}(value.${label}), ${isLast})`;
// //   });

// //   const b = [`output = string.concat(`, `"{",`, ...addCommaSeparators(memberSegments), `"}"`];
// //   // const body: StructuredText<string> = [`string memory obj = string.concat(objectKey, valueKey);`];

// //   struct.children.forEach((child, i) => {
// //     const fn = getForgeJsonSerializeFunction(ctx, child);
// //     const statement = `${fn}(obj, "${child.labelFromParent}", value.${child.labelFromParent});`;
// //     if (i === struct.children.length - 1) {
// //       body.push(`string memory finalJson = ${statement}`);
// //       body.push(`return vm.serializeString(objectKey, valueKey, finalJson);`);
// //     } else {
// //       body.push(statement);
// //     }
// //   });
// //   return addSerializeFunction(ctx, struct, body);
// // }
