/**
 * AST node factories for Solidity constant variable declarations.
 *
 * Provides typed helpers to create `uint`, `bytes`, and `string` constant
 * VariableDeclaration nodes with their corresponding type names and literals.
 */
import {
  ASTContext,
  DataLocation,
  ElementaryTypeName,
  Literal,
  LiteralKind,
  Mutability,
  StateVariableVisibility,
  staticNodeFactory,
  utf8ToHex,
  VariableDeclaration
} from "solc-typed-ast";

/** Creates an ElementaryTypeName for `uint{size}`. */
export function makeTypeNameUint(ctx: ASTContext, size: number): ElementaryTypeName {
  return staticNodeFactory.makeElementaryTypeName(ctx, `uint${size}`, `uint${size}`, "nonpayable");
}
/** Creates an ElementaryTypeName for `bytes{size}`. */
export function makeTypeNameFixedBytes(ctx: ASTContext, size: number): ElementaryTypeName {
  return staticNodeFactory.makeElementaryTypeName(
    ctx,
    `bytes${size}`,
    `bytes${size}`,
    "nonpayable"
  );
}

export function makeTypeNameUint256(ctx: ASTContext): ElementaryTypeName {
  return makeTypeNameUint(ctx, 256);
}

export function makeTypeNameString(ctx: ASTContext): ElementaryTypeName {
  return staticNodeFactory.makeElementaryTypeName(ctx, "string", "string", "nonpayable");
}

/** Creates a numeric Literal AST node. */
export function makeLiteralNumber(ctx: ASTContext, n: string | number): Literal {
  const value = n.toString();
  return staticNodeFactory.makeLiteral(
    ctx,
    `int_const ${value}`,
    LiteralKind.Number,
    utf8ToHex(value),
    value
  );
}

/** Creates a string Literal AST node. */
export function makeLiteralString(ctx: ASTContext, n: string): Literal {
  const value = n.toString();
  return staticNodeFactory.makeLiteral(
    ctx,
    `literal_string ${value}`,
    LiteralKind.String,
    "",
    value
  );
}

/** Creates a constant VariableDeclaration with a given type name and literal value. */
export function makeConstant(
  ctx: ASTContext,
  name: string,
  typeName: ElementaryTypeName,
  literal: Literal,
  scope: number
): VariableDeclaration {
  return staticNodeFactory.makeVariableDeclaration(
    ctx,
    true,
    false,
    name,
    scope,
    false,
    DataLocation.Default,
    StateVariableVisibility.Internal,
    Mutability.Constant,
    typeName.typeString,
    undefined,
    typeName,
    undefined,
    literal
  );
}

export function makeConstantString(
  ctx: ASTContext,
  name: string,
  value: string,
  scope: number
): VariableDeclaration {
  return makeConstant(ctx, name, makeTypeNameString(ctx), makeLiteralString(ctx, value), scope);
}

export function makeConstantUint(
  ctx: ASTContext,
  name: string,
  value: string | number,
  size: number,
  scope: number
): VariableDeclaration {
  return makeConstant(ctx, name, makeTypeNameUint(ctx, size), makeLiteralNumber(ctx, value), scope);
}

export function makeConstantFixedBytes(
  ctx: ASTContext,
  name: string,
  value: string | number,
  size: number,
  scope: number
): VariableDeclaration {
  return makeConstant(
    ctx,
    name,
    makeTypeNameFixedBytes(ctx, size),
    makeLiteralNumber(ctx, value),
    scope
  );
}

/** Discriminator for the elementary type of a constant declaration. */
export enum ConstantKind {
  String,
  Uint,
  FixedBytes
}

/** Factory that dispatches to the appropriate typed constant creator based on {@link ConstantKind}. */
export function makeConstantDeclaration(
  ctx: ASTContext,
  name: string,
  kind: ConstantKind,
  value: string | number,
  scope: number,
  size?: number
): VariableDeclaration {
  if (kind == ConstantKind.String) {
    return makeConstantString(ctx, name, value.toString(), scope);
  } else if (kind == ConstantKind.Uint) {
    return makeConstantUint(ctx, name, value, size ?? 256, scope);
  } else if (kind == ConstantKind.FixedBytes) {
    return makeConstantFixedBytes(ctx, name, value, size ?? 32, scope);
  } else {
    throw Error(`Unsupported literal kind: ${kind}`);
  }
}
