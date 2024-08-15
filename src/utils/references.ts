/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  Assignment,
  ASTNode,
  ASTSearch,
  FunctionCall,
  FunctionDefinition,
  Identifier,
  IdentifierPath,
  isInstanceOf,
  MemberAccess,
  ModifierDefinition,
  StructDefinition,
  UserDefinedTypeName,
  VariableDeclaration,
  YulAssignment,
  YulFunctionCall,
  YulIdentifier
} from "solc-typed-ast";

// Information about how and where a variable is used in a function.
export type VariableReference =
  | {
      kind: "FunctionParameter";
      fn: FunctionDefinition;
      subReferences: VariableReference[];
      call: FunctionCall;
      parameter: VariableDeclaration;
    }
  | {
      kind: "VariableReference";
      ref: Identifier | MemberAccess | YulIdentifier;
      update?: PotentialVariableUpdate;
    };

export type PotentialVariableUpdate =
  | {
      kind: "assignment";
      assignment: Assignment | YulAssignment;
    }
  | {
      kind: "mstore";
      mstore: YulFunctionCall;
    };

function isOnLeftSideOfAssignment(expr: ASTNode): boolean {
  const assignment = expr.getClosestParentByType(Assignment);
  return Boolean(
    assignment?.vLeftHandSide?.getChildrenBySelector((child) => child === expr)?.length
  );
}

function isOnLeftSideOfYulAssignment(expr: ASTNode): boolean {
  const assignment = expr.getClosestParentByType(YulAssignment);
  return assignment?.variableNames?.includes(expr as YulIdentifier) ?? false;
}

function isInMstorePointerExpression(expr: ASTNode): boolean {
  const mstore = expr.getClosestParentBySelector(
    (node) => node instanceof YulFunctionCall && node.vFunctionName.name === "mstore"
  ) as YulFunctionCall | undefined;
  if (!mstore) {
    return false;
  }
  const pointer = mstore.vArguments[0];
  return pointer.getChildrenBySelector((child) => child === expr)?.length === 1;
}

function findVariableChanges(ref: VariableReference) {
  if (ref.kind === "VariableReference") {
    // Check if ref is on the left hand side of the assignment
    if (isOnLeftSideOfAssignment(ref.ref)) {
      const assignment = ref.ref.getClosestParentByType(Assignment)!;
      ref.update = {
        kind: "assignment",
        assignment
      };
    }
    if (isOnLeftSideOfYulAssignment(ref.ref)) {
      const assignment = ref.ref.getClosestParentByType(YulAssignment)!;
      ref.update = {
        kind: "assignment",
        assignment
      };
    }
    if (isInMstorePointerExpression(ref.ref)) {
      const mstore = ref.ref.getClosestParentBySelector(
        (node) => node instanceof YulFunctionCall && node.vFunctionName.name === "mstore"
      ) as YulFunctionCall;
      ref.update = {
        kind: "mstore",
        mstore
      };
    }
  } else {
    ref.subReferences.forEach(findVariableChanges);
  }
}

export function getReferencesToFunctionOrVariable(
  search: ASTSearch,
  fnOrVar: VariableDeclaration | FunctionDefinition
): Array<Identifier | MemberAccess | YulIdentifier | IdentifierPath> {
  const identifiers = search.find("Identifier", {
    referencedDeclaration: fnOrVar.id
  });
  const memberAccess = search.find("MemberAccess", {
    referencedDeclaration: fnOrVar.id
  });
  const yulIdentifiers = search.find("YulIdentifier", {
    referencedDeclaration: fnOrVar.id
  });

  const results: Array<Identifier | MemberAccess | YulIdentifier | IdentifierPath> = [
    ...identifiers,
    ...memberAccess,
    ...yulIdentifiers
  ];
  if (fnOrVar instanceof FunctionDefinition) {
    const identifierPaths = search.find("IdentifierPath", {
      referencedDeclaration: fnOrVar.id
    });
    results.push(...identifierPaths);
  }
  return results;
}

export function trackVariableReferences(
  def: VariableDeclaration,
  scope: FunctionDefinition | ModifierDefinition
): VariableReference[] {
  /*  ASTSearch.from(scope).find("FunctionCall", {
    children: [
      {
        any: [
          { type: "Identifier", referencedDeclaration: def.id }
          // {type: "MemberAccess", referencedDeclaration: def.id },
        ]
      }
    ]
  }); */
  const refs = getReferencesToFunctionOrVariable(ASTSearch.from(scope), def);
  const references: VariableReference[] = [];
  for (const ref of refs) {
    if (
      isInstanceOf(ref, MemberAccess, Identifier) &&
      ref.parent instanceof FunctionCall &&
      ref.parent.vReferencedDeclaration instanceof FunctionDefinition
    ) {
      const call = ref.parent as FunctionCall;
      const fn = call.vReferencedDeclaration as FunctionDefinition;
      const argIndex = call.vArguments.indexOf(ref);
      const param = fn.vParameters.vParameters[argIndex];
      const subReferences = trackVariableReferences(param, fn);
      const reference: VariableReference = {
        kind: "FunctionParameter",
        fn,
        subReferences,
        call,
        parameter: param
      };
      references.push(reference);
      findVariableChanges(reference);
    } else if (
      ref instanceof Identifier &&
      ref.parent instanceof MemberAccess &&
      ref.parent.vReferencedDeclaration instanceof FunctionDefinition &&
      ref.parent.parent instanceof FunctionCall
    ) {
      const call = ref.parent.parent as FunctionCall;
      const fn = call.vReferencedDeclaration as FunctionDefinition;
      /* if (call.vArguments.length === 0) {
        throw Error(`Got empty params`);
      } */
      if (fn.name === "normalizeAmount") {
        console.log(fn.vParameters.vParameters.map((p) => p.typeString));
        console.log(call.vArguments.map((p) => p.typeString));

        throw Error(`Got normalizeAmount`);
      }
      const param = fn.vParameters.vParameters[0];
      const subReferences = trackVariableReferences(param, fn);
      const reference: VariableReference = {
        kind: "FunctionParameter",
        fn,
        subReferences,
        call,
        parameter: param
      };
      references.push(reference);
      findVariableChanges(reference);
    } else {
      const reference: VariableReference = {
        kind: "VariableReference",
        ref: ref as Identifier | MemberAccess | YulIdentifier
      };
      const type = (def.vType as UserDefinedTypeName).vReferencedDeclaration as StructDefinition;
      /* if (ref.parent instanceof MemberAccess) {
        if (ref.parent.memberName === "normalizeAmount") {
          const calltype = ref.parent.parent!;
          console.log(ref.parent.vReferencedDeclaration?.type);
          console.log(calltype instanceof FunctionCall && calltype.vReferencedDeclaration?.name);
          throw Error(
            `member name normalizeAmount :: ${ref.type} ${ref instanceof Identifier && ref.name}`
          );
        }
      } */
      //   if (!type.vMembers.some((member) => member.name === ref.memberName)) {
      //     console.log(`Got member ${ref.memberName} but struct ${type.name} has no such member`);
      //     console.log(`Parent type: ${ref.parent?.type}`);
      //     throw Error();
      //   }
      // }
      // if (ref instanceof Identifier) {
      //   if (!type.vMembers.some((member) => member.name === ref.name)) {
      //     console.log(`Got member ${ref.name} but struct ${type.name} has no such member`);
      //     console.log(`Parent type: ${ref.parent?.type}`);
      //     throw Error();
      //   }
      // }

      references.push(reference);
      findVariableChanges(reference);
    }
  }
  return references;
}
