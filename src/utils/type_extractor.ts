import { isInstanceOf } from "solc-typed-ast";
import { ErrorType, EventType, FunctionType, TupleType, TypeNode } from "../ast";

export class TypeExtractor {
  private _types = new Map<string, TypeNode>();
  private _functionParameters = new Map<string, TypeNode>();

  get types(): TypeNode[] {
    return [...this._types.values()];
  }

  get functionParameters(): TypeNode[] {
    return [...this._functionParameters.values()];
  }

  extractCoderTypes(type: TypeNode): TypeNode[] {
    if (type instanceof FunctionType) {
      if (!type.parameters) return [];
      const parameters = this.extractCoderTypes(type.parameters);
      parameters.forEach((parameter) => {
        const identifier = parameter.identifier;
        if (!this._functionParameters.has(identifier)) {
          this._functionParameters.set(identifier, parameter);
        }
      });
      return parameters;
    }
    if (isInstanceOf(type, ErrorType, EventType)) {
      if (!type.parameters) return [];
      return this.extractCoderTypes(type.parameters);
    }
    if (type instanceof TupleType) {
      return type.vMembers.reduce(
        (arr, member) => [...arr, ...this.extractCoderTypes(member)],
        [] as TypeNode[]
      );
    }
    if (type.isValueType) return [];
    const identifier = type.identifier;
    if (!this._types.has(identifier)) {
      this._types.set(identifier, type);
    }
    return [type];
  }

  static extractCoderTypes(types: TypeNode[]): {
    types: TypeNode[];
    functionParameters: TypeNode[];
  } {
    const parser = new TypeExtractor();
    types.map((t) => parser.extractCoderTypes(t));
    return {
      types: parser.types,
      functionParameters: parser.functionParameters
    };
  }
}
