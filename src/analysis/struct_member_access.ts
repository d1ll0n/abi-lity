/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  ASTSearch,
  ContractDefinition,
  FunctionDefinition,
  MemberAccess,
  StructDefinition,
  UserDefinedTypeName,
  VariableDeclaration
} from "solc-typed-ast";
import { trackVariableReferences, VariableReference } from "../utils/references";

type StructAccesses = Record<
  string,
  {
    read: number;
    write: number;
    refs: VariableReference[];
  }
>;

const updateStructAccesses = (ref: VariableReference, accesses: StructAccesses, inCall = false) => {
  if (ref.kind === "VariableReference") {
    if (ref.ref.parent instanceof MemberAccess) {
      const member = ref.ref.parent.memberName;
      accesses[member] = accesses[member] ?? { read: 0, write: 0 };
      if (ref.update) {
        accesses[member].write++;
      } else {
        accesses[member].read++;
      }
    }
  } else {
    ref.subReferences.forEach((subRef) => updateStructAccesses(subRef, accesses, true));
  }
};

/* function trackStructMemberUsage(scope: FunctionDefinition, struct: StructDefinition) {
  const parameter = scope.vParameters.vParameters.find((param) => {
    param.vType instanceof UserDefinedTypeName && param.vType.referencedDeclaration === struct.id;
  });

  if (parameter === undefined) {
    return [];
  }
  const refs = trackVariableReferences(parameter, scope);
  const membersTouched = refs;
  return [];
} */

export type StructMemberAccessProfile = {
  // kind: "read" | "write" | "read-write";
  read: number;
  write: number;
  member: string;
};

type StructAccessGraphNode = {
  fn: FunctionDefinition;
};

class FunctionAccessGraphNode {
  membersDirectlyRead: string[] = [];
  membersDirectlyWritten: string[] = [];
  subcalls: FunctionAccessGraphNode[] = [];
}

export type StructMemberAccessInFunction = {
  fn: FunctionDefinition;
  members: StructMemberAccessProfile[];
  subCalls: string[];
};

export function trackStructUsageInContract(
  struct: StructDefinition,
  contract: ContractDefinition
): StructMemberAccessInFunction[] {
  const search = ASTSearch.fromContract(contract);
  const functions = search.find("FunctionDefinition").filter(
    (fn) =>
      !!fn.getChildrenBySelector(
        (child) =>
          child instanceof VariableDeclaration &&
          child.vType instanceof UserDefinedTypeName &&
          child.vType.referencedDeclaration === struct.id &&
          child.name !== undefined
      )[0]
    /* fn.vParameters.vParameters.some((param) => {
      return (
        param.vType instanceof UserDefinedTypeName &&
        param.vType.referencedDeclaration === struct.id
      );
    }) */
  );
  console.log(`Got fns: ${functions.length}`);

  return trackStructUsageInFunctions(struct, functions);
}

export function trackStructUsageInFunctions(
  struct: StructDefinition,
  functions: FunctionDefinition[]
): StructMemberAccessInFunction[] {
  /*   functions = functions.filter((fn) =>
  fn.getChildrenBySelector(
    (child) =>
      child instanceof VariableDeclaration &&
      child.vType instanceof UserDefinedTypeName &&
      child.vType.referencedDeclaration === struct.id &&
      child.name !== undefined
  ).length > 0
  )) */

  // fn.getChildrenBySelector(node => node)
  /* fn.vParameters.vParameters.some((param) => {
      return (
        param.vType instanceof UserDefinedTypeName &&
        param.vType.referencedDeclaration === struct.id
      );
    }) */
  // );

  return functions.map((fn) => {
    const param = fn.getChildrenBySelector(
      (child) =>
        child instanceof VariableDeclaration &&
        child.vType instanceof UserDefinedTypeName &&
        child.vType.referencedDeclaration === struct.id &&
        child.name !== undefined
    )[0]! as VariableDeclaration;

    /*  fn.vParameters.vParameters.find(
      (param) =>
        param.vType instanceof UserDefinedTypeName &&
        param.vType.referencedDeclaration === struct.id
    )!; */
    const refs = trackVariableReferences(param, fn);
    const accesses: StructAccesses = {};
    refs.forEach((ref) => updateStructAccesses(ref, accesses));
    const subCalls = (
      refs.filter((r) => r.kind === "FunctionParameter") as Array<
        Extract<VariableReference, { kind: "FunctionParameter" }>
      >
    ).map((r) => r.fn.name);
    const membersTouched: StructMemberAccessProfile[] = Object.entries(accesses).map(
      ([member, { read, write }]) => ({
        member,
        read,
        write
      })
    );
    return {
      fn,
      members: membersTouched,
      subCalls
    };
  });
}
