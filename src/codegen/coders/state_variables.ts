/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  ArrayTypeName,
  assert,
  ASTNodeFactory,
  ASTSearch,
  ContractDefinition,
  DataLocation,
  ElementaryTypeName,
  FunctionDefinition,
  FunctionKind,
  FunctionStateMutability,
  FunctionVisibility,
  Identifier,
  IndexAccess,
  Mapping,
  MemberAccess,
  Mutability,
  StateVariableVisibility,
  staticNodeFactory,
  StructDefinition,
  TypeName,
  UserDefinedTypeName,
  VariableDeclaration
} from "solc-typed-ast";

import { getUniqueNameInScope } from "../../utils";
import { getReferencesToFunctionOrVariable } from "../../utils/references";

/**
 * When we find a public state variable with an override, the only thing that can
 * be overridden is an external function in a base contract.
 *
 * To replace the variable's getter function, we need to:
 * 1. Create a new external function with the signature of the getter.
 * 2. Set the function's overrideSpecifier to a copy of the variable's
 * 3. Rename the variable, adding underscore prefixes until we get a unique identifier.
 * 4. Set the variable's visibility to `internal`
 * 5. Find all identifiers referencing the variable and replace their `name` with the new name
 */
export function renamePublicStateVariables(
  search: ASTSearch
): Array<[VariableDeclaration, FunctionDefinition]> {
  const publicStateVariables = search.findStateVariablesByVisibility(
    StateVariableVisibility.Public
  );
  return publicStateVariables.map((decl) => {
    return [decl, makeStateVariableGetter(search, decl)];
  });
}

const getLoc = (decl: VariableDeclaration) => {
  if (decl.vType === undefined) {
    return DataLocation.Default;
  }
  if (decl.vType instanceof ElementaryTypeName) {
    if (decl.vType.name === "string" || decl.vType.name === "bytes") {
      return DataLocation.Memory;
    }
    return DataLocation.Default;
  }
  if (
    decl.vType instanceof ArrayTypeName ||
    (decl.vType instanceof UserDefinedTypeName &&
      decl.vType.vReferencedDeclaration instanceof StructDefinition)
  ) {
    return DataLocation.Memory;
  }
  return DataLocation.Default;
};

function makeStateVariableGetter(
  search: ASTSearch,
  stateVariable: VariableDeclaration
): FunctionDefinition {
  const factory = new ASTNodeFactory(stateVariable.requiredContext);
  const body = factory.makeBlock([]);
  const contract = stateVariable.getClosestParentByType(ContractDefinition)!;

  const fn = factory.makeFunctionDefinition(
    stateVariable.id,
    FunctionKind.Function,
    stateVariable.name,
    false,
    FunctionVisibility.External,
    FunctionStateMutability.View,
    false,
    factory.makeParameterList([]),
    factory.makeParameterList([]),
    [],
    stateVariable.vOverrideSpecifier && factory.copy(stateVariable.vOverrideSpecifier),
    body
  );
  stateVariable.vOverrideSpecifier = undefined;
  stateVariable.name = getUniqueNameInScope(stateVariable, stateVariable.name, "_");
  stateVariable.visibility = StateVariableVisibility.Internal;
  contract.insertAfter(fn, stateVariable);

  const references = getReferencesToFunctionOrVariable(search, stateVariable);
  for (const ref of references) {
    if (ref instanceof MemberAccess) {
      ref.memberName = stateVariable.name;
    } else {
      ref.name = stateVariable.name;
    }
  }

  let i = 0;
  let vType = stateVariable.vType;
  let hasKey = vType instanceof ArrayTypeName || vType instanceof Mapping;
  const expressionParts: string[] = [];
  let baseExpression: Identifier | IndexAccess | MemberAccess =
    factory.makeIdentifierFor(stateVariable);

  while (hasKey) {
    let paramType: TypeName | undefined;
    let keyType: string | undefined;
    let keyName: string | undefined;
    if (vType instanceof Mapping) {
      keyType = vType.vKeyType.typeString;
      keyName = `key${i++}`;
      paramType = factory.copy(vType.vKeyType);
      expressionParts.push(`.${keyName}`);
      vType = vType.vValueType;
    } else if (vType instanceof ArrayTypeName) {
      keyType = "uint256";
      keyName = `index${i++}`;
      paramType = factory.makeElementaryTypeName("uint256", `uint256`, "nonpayable");
      expressionParts.push(`[${keyName}]`);
      vType = vType.vBaseType;
    } else {
      console.log(`vType: ${vType?.type}`);
    }
    hasKey = vType instanceof ArrayTypeName || vType instanceof Mapping;
    if (keyType && keyName) {
      if (paramType) {
        const param = staticNodeFactory.makeVariableDeclaration(
          stateVariable.requiredContext,
          false,
          false,
          keyName,
          fn.scope,
          false,
          DataLocation.Default,
          StateVariableVisibility.Default,
          Mutability.Mutable,
          keyType,
          undefined,
          paramType
        );
        fn.vParameters.appendChild(param);
        param.storageLocation = getLoc(param);
        baseExpression = factory.makeIndexAccess(
          `uint256`,
          baseExpression,
          factory.makeIdentifierFor(param)
        );
      }
    }
  }
  // If the final return type is a struct, we need to create a temporary variable
  // to hold the return value, and then return the members of the struct as a tuple.
  if (
    vType instanceof UserDefinedTypeName &&
    vType.vReferencedDeclaration instanceof StructDefinition
  ) {
    const tmpVar = factory.makeVariableDeclaration(
      false,
      false,
      stateVariable.name,
      stateVariable.scope,
      false,
      DataLocation.Memory,
      StateVariableVisibility.Default,
      Mutability.Mutable,
      vType.typeString,
      undefined,
      factory.copy(vType)
    );

    body.appendChild(
      factory.makeVariableDeclarationStatement([tmpVar.id], [tmpVar], baseExpression)
    );
    const tmpVarId = factory.makeIdentifierFor(tmpVar);
    const returnValues: MemberAccess[] = [];
    for (const member of vType.vReferencedDeclaration.vMembers) {
      const memberType = factory.copy(member.vType!);
      if (memberType instanceof ArrayTypeName) {
        continue;
      }
      const memberName = member.name;
      const param = factory.makeVariableDeclaration(
        false,
        false,
        memberName,
        fn.scope,
        false,
        DataLocation.Default,
        StateVariableVisibility.Default,
        Mutability.Mutable,
        memberType.typeString,
        undefined,
        memberType
      );
      fn.vReturnParameters.appendChild(param);
      param.storageLocation = getLoc(param);
      returnValues.push(
        factory.makeMemberAccess(tmpVarId.typeString, tmpVarId, memberName, tmpVar.id)
      );
    }
    body.appendChild(
      factory.makeReturn(
        returnValues.length,
        returnValues.length === 1
          ? returnValues[0]
          : factory.makeTupleExpression(
              `(${vType.vReferencedDeclaration.vMembers.map((m) => m.typeString).join(",")})`,
              false,
              returnValues
            )
      )
    );
  } else {
    assert(vType !== undefined, `Error replacing public state variable: return type is undefined`);
    const param = factory.makeVariableDeclaration(
      false,
      false,
      "",
      stateVariable.scope,
      false,
      DataLocation.Default,
      StateVariableVisibility.Default,
      Mutability.Mutable,
      vType.typeString,
      undefined,
      factory.copy(vType)
    );
    fn.vReturnParameters.appendChild(param);
    param.storageLocation = getLoc(param);
    body.appendChild(factory.makeReturn(1, baseExpression));
  }
  return fn;
}
