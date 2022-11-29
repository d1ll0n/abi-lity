import { simplify } from "mathjs";
import {
  ASTContext,
  ASTSearch,
  YulBlock,
  YulExpression,
  YulFunctionCall,
  staticNodeFactory,
  YulLiteralKind,
  ASTNode,
  YulIdentifier,
  YulAssignment,
  YulVariableDeclaration,
  YulExpressionStatement
} from "solc-typed-ast";
import {
  expressionGt,
  simplifyYulExpression
} from "solc-typed-ast/dist/ast/implementation/yul/algebra/algebra";
import { last } from "./array";

export type PendingDynamicCopy = {
  dst: YulExpression;
  src: YulExpression;
  size: YulExpression;
  names?: string[];
};

const readCopy = (node: YulFunctionCall): PendingDynamicCopy => {
  if (node.vFunctionName.name !== "calldatacopy") {
    throw Error(`Can not read non-calldatacopy call as copy. Received: ${node.vFunctionName.name}`);
  }
  const [dst, src, size] = node.vArguments;
  return {
    dst,
    src,
    size
  };
};

const dynamicDistance = (
  copy1: PendingDynamicCopy,
  copy2: PendingDynamicCopy
): YulExpression | undefined => {
  const srcDist = simplify(copy2.src.sub(copy1.src.add(copy1.size)).toMathNode());
  const dstDist = simplify(copy2.dst.sub(copy1.dst.add(copy1.size)).toMathNode());

  if (!srcDist.equals(dstDist)) {
    return undefined;
  }
  return copy2.src.sub(copy1.src.add(copy1.size)).simplify();
};

function findAssignmentsAndDeclarations(
  parent: ASTNode,
  id: YulIdentifier,
  onlyDirectChild = false
): Array<YulAssignment | YulVariableDeclaration> {
  return parent.getChildrenBySelector((node) => {
    return (
      (!onlyDirectChild || node.parent === parent) &&
      ((node instanceof YulAssignment && node.variableNames.some((v) => v.name === id.name)) ||
        (node instanceof YulVariableDeclaration && node.variables.some((v) => v.name === id.name)))
    );
  });
}

function getDependenciesAssignedBetween(fromNode: YulFunctionCall, toNode: YulFunctionCall) {
  const parent = toNode.parent as ASTNode;
  const idParams = ASTSearch.from(toNode.vArguments).find("YulIdentifier");

  const fromIndex = parent.children.indexOf(fromNode);
  const toIndex = parent.children.indexOf(toNode);
  if (idParams.length) {
    const assignments = idParams.reduce(
      (assignments, id) => [...assignments, ...findAssignmentsAndDeclarations(parent, id, true)],
      [] as Array<YulAssignment | YulVariableDeclaration>
    );
    return assignments
      .map((assignment) => parent.children.indexOf(assignment))
      .filter((index) => index > fromIndex && index < toIndex);
  }
  return [];
}

export function combineSequentialCalldataCopies(block: YulBlock): void {
  const ctx = block.context as ASTContext;
  const maxIntermediateBytesLiteral = staticNodeFactory.makeYulLiteral(
    ctx,
    YulLiteralKind.Number,
    4 * 32,
    ""
  );
  const copies = [
    ...(block.getChildrenBySelector((child) => {
      return (
        child instanceof YulFunctionCall &&
        child.vIdentifier === "calldatacopy" &&
        (child.parent === block ||
          (child.parent instanceof YulExpressionStatement && child.parent?.parent === block))
      );
    }) as YulFunctionCall[])
  ].sort((a, b) => expressionGt(readCopy(a).dst, readCopy(b).dst));
  const newCopies: YulFunctionCall[] = [copies[0]];

  for (let i = 1; i < copies.length; i++) {
    const prevNode = last(newCopies);
    const nextNode = copies[i];
    const prevCopy = readCopy(prevNode);
    const nextCopy = readCopy(nextNode);
    const dist = dynamicDistance(prevCopy, nextCopy);
    const mightExceedSizeLimit =
      dist !== undefined && expressionGt(dist, maxIntermediateBytesLiteral) !== -1;
    if (dist === undefined || mightExceedSizeLimit) {
      newCopies.push(nextNode);
      continue;
    }
    prevNode.removeChild(prevCopy.size);
    const size = simplifyYulExpression(prevCopy.size.add(dist).add(nextCopy.size));
    prevNode.appendChild(size);

    if (nextCopy.names) {
      const docs = [...((prevNode.documentation as string) || "").split("\n"), ...nextCopy.names];
      (prevNode.documentation as string) = docs.join("\n");
    }
    const dependenciesIncompatibleWithPrev = getDependenciesAssignedBetween(prevNode, nextNode);
    const prevChildNode =
      prevNode.parent instanceof YulExpressionStatement ? prevNode.parent : prevNode;
    const nextChildNode =
      nextNode.parent instanceof YulExpressionStatement ? nextNode.parent : nextNode;

    if (dependenciesIncompatibleWithPrev.length) {
      block.removeChild(prevChildNode);
      block.replaceChild(prevChildNode, nextChildNode);
    } else {
      block.removeChild(nextChildNode);
    }
  }
}
