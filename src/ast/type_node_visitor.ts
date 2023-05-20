import { assert, isInstanceOf } from "solc-typed-ast";
import {
  ArrayType,
  PossibleReferenceTypes,
  ReferenceType,
  StructType,
  TupleType,
  TypeNode,
  TypeNodeWithChildren,
  UABIType,
  ValueType,
  isUABIType
} from ".";
import { toPascalCase } from "../codegen/names";
import { ABITypeKind } from "../constants";

type KindName = keyof typeof ABITypeKind;

type TypeNodeFor<K extends string> = K extends KindName
  ? Extract<UABIType, { kind: typeof ABITypeKind[K] }>
  : never;

type WithReturnType<T> = ((x: T) => any) extends (x: T) => infer R ? (x: T) => R : never;

type TypeNodeVisitorType = {
  [K in KindName as `visit${K}`]?: WithReturnType<TypeNodeFor<K>>;
};

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface TypeNodeVisitor extends TypeNodeVisitorType {}

export abstract class DefaultVisitor implements TypeNodeVisitor {
  public accept(type: TypeNode): any {
    return this.visit(type);
  }

  protected _shouldSkipVisitWith(_type: TypeNode): any {
    return undefined;
  }

  protected _getVisitFunction<T extends UABIType>(type: T): WithReturnType<T> | undefined {
    const self = this as TypeNodeVisitor;
    const kind = type.kind;
    const k = toPascalCase(kind) as KindName;
    const fn = self[`visit${k}`];
    return fn?.bind(this) as WithReturnType<T>;
  }

  protected _afterVisit<T extends UABIType>(_type: T, result: any): any {
    return result;
  }

  visit(type: TypeNode): any {
    const skipValue = this._shouldSkipVisitWith(type);
    if (skipValue !== undefined) return skipValue;
    assert(isUABIType(type), `Expected UABIType, got ${type.constructor.name}`);

    const fn = this._getVisitFunction(type);
    let result: any;
    if (fn) {
      result = fn(type as TypeNodeFor<typeof type.kind>);
    } else if (type instanceof ValueType) {
      result = this.visitValueType(type);
    } else if (isInstanceOf(type, ...PossibleReferenceTypes)) {
      result = this.visitUnmatchedReferenceType(type);
    }
    return this._afterVisit(type, result);
  }

  visitValueType(_type: ValueType): any {
    return this.defaultReturnValue;
  }

  visitUnmatchedReferenceType(_type: ReferenceType): any {
    return this.defaultReturnValue;
  }

  abstract defaultReturnValue: any;

  visitChildren(type: TypeNodeWithChildren<TypeNode>): any {
    return type.children.map((child) => this.visit(child as UABIType));
  }

  visitStruct(type: StructType): any {
    return this.visitChildren(type);
  }

  visitTuple(type: TupleType): any {
    return this.visitChildren(type);
  }

  visitArray(type: ArrayType): any {
    return this.visitChildren(type);
  }
}
