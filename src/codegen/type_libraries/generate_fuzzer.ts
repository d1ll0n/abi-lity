// import {} from "scuffed-abi"
import { DataLocation, FunctionStateMutability, assert } from "solc-typed-ast";
import {
  AddressType,
  ArrayType,
  BoolType,
  BytesType,
  ContractType,
  DefaultVisitor,
  EnumType,
  FixedBytesType,
  IntegerType,
  StructType,
  TypeNode,
  UABIType,
  ValueType
} from "../../ast";
import { StructuredText } from "../../utils";
import { WrappedScope } from "../ctx/contract_wrapper";
import { toPascalCase } from "../names";
import { ConstantKind } from "../../utils/make_constant";
import { UserDefinedValueType } from "../../ast/value/user_defined_value_type";

export const VisitorByScope: WeakMap<WrappedScope, FuzzGenerator> = new WeakMap();
class FuzzGenerator extends DefaultVisitor {
  existingTypeFunctions: Map<string, string> = new Map();

  constructor(private ctx: WrappedScope) {
    super();
    VisitorByScope.set(ctx, this);
  }

  static getVisitor(ctx: WrappedScope): FuzzGenerator {
    let visitor = VisitorByScope.get(ctx);
    if (!visitor) {
      visitor = new FuzzGenerator(ctx);
    }
    return visitor;
  }

  protected _shouldSkipVisitWith(type: TypeNode): string | undefined {
    return this.existingTypeFunctions.get(type.identifier);
  }

  protected _afterVisit<T extends UABIType>(_type: T, result: any): string {
    this.existingTypeFunctions.set(_type.identifier, result);
    return result;
  }

  get defaultReturnValue(): any {
    throw new Error("No default fuzzer.");
  }

  addFuzzFunction(type: TypeNode, body: StructuredText, comment?: StructuredText): string {
    const outputParam = type.writeParameter(DataLocation.Memory, "result");
    return this.ctx.addInternalFunction(
      `fuzz${type.pascalCaseName}`,
      "PRNG rng",
      outputParam,
      body,
      FunctionStateMutability.Pure,
      comment
    );
  }

  visitValueType(type: ValueType) {
    if (type instanceof BoolType) {
      return this.addFuzzFunction(
        type,
        `return rng.range(0, 1) == 1;`,
        `Generates a random boolean from a seed`
      );
    }
    if (type instanceof IntegerType) {
      const min = type.signed ? `type(${type.identifier}).min()` : 0;
      const max = `type(${type.identifier}).max()`;
      const value = `rng.range(${min}, ${max})`;
      const asType = type.identifier !== "uint256" ? `${type.identifier}(${value})` : value;
      return this.addFuzzFunction(
        type,
        [`return ${asType};`],
        `Generates a random ${type.identifier} from a seed`
      );
    }
    // @todo Add support for selecting address from a configured set
    if (type instanceof AddressType) {
      const addr = `address(rng.range(0, type(uint160).max()))`;
      const value = type instanceof ContractType ? `${type.name}(${addr})` : addr;
      return this.addFuzzFunction(
        type,
        `return ${value};`,
        `Generates a random ${type instanceof ContractType ? type.name : "address"} from a seed`
      );
    }
    if (type instanceof FixedBytesType) {
      const eqUint = `uint${type.exactBits}`;
      const value = `rng.range(0, type(${eqUint}).max())`;
      const asUint = type.exactBits !== 256 ? `${eqUint}(${value})` : value;
      const bytes = `${type.identifier}(${asUint})`;
      return this.addFuzzFunction(
        type,
        [`return ${bytes};`],
        `Generates a random ${type.identifier} from a seed`
      );
    }
    if (type instanceof EnumType) {
      const value = `rng.range(0, ${type.members.length - 1})`;
      return this.addFuzzFunction(
        type,
        `return ${type.name}(${value});`,
        `Generates a random ${type.identifier} from a seed`
      );
    }

    if (type instanceof UserDefinedValueType) {
      const baseFuzzer = this.visit(type.underlyingType);
      return this.addFuzzFunction(
        type,
        `return ${type.name}(${baseFuzzer}(rng));`,
        `Generates a random ${type.identifier} from a seed`
      );
    }

    throw new Error(`Could not make fuzzer for type: ${type.pp()}`);
  }

  visitStruct(type: StructType) {
    const body: StructuredText = type.children.map((m) => {
      const fn = this.visit(m);
      const label = m.labelFromParent;
      return `result.${label} = ${fn}(rng);`;
    });
    return this.addFuzzFunction(type, body, `Generates a random ${type.identifier} from a seed`);
  }

  visitBytes(type: BytesType) {
    const maxSizeName = toPascalCase(`MaxBytesLength`);
    this.ctx.addConstant(maxSizeName, 256, ConstantKind.Uint);
    const size = `rng.range(0, ${maxSizeName})`;
    const body: StructuredText = [
      `uint256 length = ${size};`,
      `result = new bytes(length);`,
      `uint pointer;`,
      `uint terminalPointer;`,
      `assembly {`,
      [
        `pointer := add(result, 0x20)`,
        `terminalPointer := and(add(pointer, add(length, 31)), 0xffffffe0)`
      ],
      `}`,
      `for (; pointer < terminalPointer; pointer += 32) {`,
      [`uint word = rng.rand();`, `assembly { mstore(pointer, word) }`],
      `}`,
      `assembly { mstore(add(add(result, 0x20), length), 0) }`
    ];
    return this.addFuzzFunction(type, body, `Generates a random bytes from a seed`);
  }

  visitArray(type: ArrayType) {
    const baseType = type.baseType;
    const baseFuzzer = this.visit(baseType);
    // const suffix = type.parent ? `_Per_${type.parent?.canonicalName}` : ``;
    const maxSizeName = toPascalCase(`Max_${type.labelFromParent}Length`);
    this.ctx.addConstant(maxSizeName, 10, ConstantKind.Uint);
    const body: StructuredText = [
      `for (uint256 i = 0; i < ${type.length ?? "length"}; i++) {`,
      `  result[i] = ${baseFuzzer}(rng);`,
      `}`
    ];
    if (type.isDynamicallySized) {
      body.unshift(
        `uint256 length = rng.range(0, ${maxSizeName});`,
        `result = new ${baseType.canonicalName}[](length);`
      );
    }
    return this.addFuzzFunction(
      type,
      body,
      `Generates a random array of ${baseType.canonicalName} from a seed`
    );
  }
}
