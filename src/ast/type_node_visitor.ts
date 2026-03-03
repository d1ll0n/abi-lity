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

/**
 * Mapped type that generates optional `visit${Kind}` methods for each `ABITypeKind`.
 * Each method receives the correctly-typed TypeNode for that kind.
 */
type TypeNodeVisitorType = {
  [K in KindName as `visit${K}`]?: WithReturnType<TypeNodeFor<K>>;
};

/**
 * Visitor interface for type-safe dispatch over TypeNode kinds.
 *
 * Implementors can define `visitInteger(type: IntegerType)`, `visitStruct(type: StructType)`,
 * etc. Method names are derived from `ABITypeKind` values converted to PascalCase.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface TypeNodeVisitor extends TypeNodeVisitorType {}

/**
 * Abstract base for the visitor pattern over TypeNode trees.
 *
 * Dispatch order:
 * 1. `_shouldSkipVisitWith()` — early return if the type should be skipped
 * 2. Specific `visit${Kind}()` method if defined on the subclass
 * 3. `visitValueType()` fallback for unmatched value types
 * 4. `visitUnmatchedReferenceType()` fallback for unmatched reference types
 * 5. `_afterVisit()` — post-processing hook
 *
 * Default implementations for `visitStruct`, `visitTuple`, and `visitArray` recurse
 * into children via `visitChildren()`.
 */
export abstract class DefaultVisitor implements TypeNodeVisitor {
  /** Entry point: dispatches to the appropriate visit method for `type`. */
  public accept(type: TypeNode): any {
    return this.visit(type);
  }

  /** Override to skip visiting certain types. Return non-`undefined` to skip. */
  protected _shouldSkipVisitWith(_type: TypeNode): any {
    return undefined;
  }

  /** Resolves the `visit${Kind}` method for the given type, or `undefined` if not defined. */
  protected _getVisitFunction<T extends UABIType>(type: T): WithReturnType<T> | undefined {
    const self = this as TypeNodeVisitor;
    const kind = type.kind;
    const k = toPascalCase(kind) as KindName;
    const fn = self[`visit${k}`];
    return fn?.bind(this) as WithReturnType<T>;
  }

  /** Post-processing hook called after each visit. Override to transform results. */
  protected _afterVisit<T extends UABIType>(_type: T, result: any): any {
    return result;
  }

  /** Core dispatch: resolves and calls the appropriate visitor method. */
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

  /** Fallback for value types without a specific `visit${Kind}` method. */
  visitValueType(_type: ValueType): any {
    return this.defaultReturnValue;
  }

  /** Fallback for reference types without a specific `visit${Kind}` method. */
  visitUnmatchedReferenceType(_type: ReferenceType): any {
    return this.defaultReturnValue;
  }

  /** Default return value for unhandled types. Subclasses must define this. */
  abstract defaultReturnValue: any;

  /** Visits all children of a composite type, returning an array of results. */
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
