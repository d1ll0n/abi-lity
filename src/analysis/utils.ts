import {
  ASTNode,
  Assignment,
  Expression,
  TupleExpression,
  TupleType as SolcTupleType,
  TypeNode as SolcTypeNode,
  assert,
  PointerType,
  DataLocation,
  InferType,
  LatestCompilerVersion,
  VariableDeclaration,
  VariableDeclarationStatement
} from "solc-typed-ast";
import { StructuredText } from "../utils";
import { err, warn } from "../test_utils/logs";
import chalk from "chalk";
import { TypeNode } from "../ast";

export enum Severity {
  Warning = "Warning",
  Error = "Error"
}

export type Warning = {
  message: string;
  node: ASTNode;
  severity: Severity;
  notes?: StructuredText;
};

export const color = {
  [Severity.Warning]: warn,
  [Severity.Error]: err
};

export type DeclarationInfo = {
  decl: VariableDeclaration;
  type: TypeNode;
};

export type DestructuredAssignment = {
  left: Expression;
  right: Expression;
};

export function destructureAssignment(
  left: Expression,
  right: Expression
): DestructuredAssignment[] {
  if (left instanceof TupleExpression && right instanceof TupleExpression) {
    return mapTupleComponents(left, right);
  }
  if (right instanceof Assignment) {
    return destructureAssignment(left, right.vRightHandSide);
  }
  return [{ left, right }];
}

export function mapTupleComponents(
  left: TupleExpression,
  right: TupleExpression
): DestructuredAssignment[] {
  const leftComponents = left.vOriginalComponents;
  const rightComponents = right.vOriginalComponents;
  assert(leftComponents.length === rightComponents.length, "Tuple lengths must match");
  const assignments: DestructuredAssignment[] = [];
  for (let i = 0; i < leftComponents.length; i++) {
    const leftComp = leftComponents[i];
    const rightComp = rightComponents[i];
    if (leftComp && rightComp) {
      assignments.push(...destructureAssignment(leftComp, rightComp));
    }
  }
  return assignments;
}
const Infer = new InferType(LatestCompilerVersion);

export const usesMemory = (node: Expression | SolcTypeNode): boolean => {
  if (node instanceof Expression) {
    if (node instanceof TupleExpression) {
      return node.vOriginalComponents.some((c) => c !== null && usesMemory(c));
    }
    return usesMemory(Infer.typeOf(node));
  }
  if (node instanceof SolcTupleType) {
    return node.elements.some(usesMemory);
  }
  return node instanceof PointerType && node.location === DataLocation.Memory;
};

export function isAssignmentToReferenceType(assignment: DestructuredAssignment): boolean {
  const left = assignment.left;
  const right = assignment.right;
  return usesMemory(left) && usesMemory(right);
}

export function getAssignmentsToReferenceType(node: ASTNode): DestructuredAssignment[] {
  const assignments = node
    .getChildrenByType(Assignment)
    .reduce(
      (arr, assignment) => [
        ...arr,
        ...destructureAssignment(assignment.vLeftHandSide, assignment.vRightHandSide)
      ],
      [] as DestructuredAssignment[]
    );
  return assignments.filter(isAssignmentToReferenceType);
}

export function getInitialValue(decl: VariableDeclaration): Expression | undefined {
  const parent = decl.parent;
  if (parent instanceof VariableDeclarationStatement) {
    const init = parent.vInitialValue;
    if (init instanceof TupleExpression) {
      const tupleIdx = parent.vDeclarations.indexOf(decl);
      return init.vOriginalComponents[tupleIdx] || undefined;
    }
    return init;
  }
  return decl.vValue;
}
