/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  assert,
  ASTNodeFactory,
  ContractDefinition,
  ContractKind,
  DataLocation,
  Expression,
  FunctionCall,
  FunctionCallKind,
  FunctionDefinition,
  FunctionKind,
  FunctionStateMutability,
  FunctionVisibility,
  LiteralKind,
  Mutability,
  SourceUnit,
  StateVariableVisibility,
  staticNodeFactory,
  VariableDeclaration,
  VariableDeclarationStatement
} from "solc-typed-ast";
import { ABIEncoderVersion } from "solc-typed-ast/dist/types/abi";
import { TupleType, TypeNode } from "../../ast";
import { functionDefinitionToTypeNode } from "../../readers";
import {
  addImports,
  getParentSourceUnit,
  makeFunctionCallFor,
  isExternalFunction,
  resolveOverriddenFunctions
} from "../../utils";
import { replaceReturnStatementsWithCall } from "./abi_encode";
import { dependsOnCalldataLocation } from "../utils";
import NameGen from "../names";
import { err } from "../../test_utils/logs";
import _ from "lodash";

function getFunctionSelectorDeclaration(
  factory: ASTNodeFactory,
  scope: number
): VariableDeclaration {
  const selectorDeclaration = factory.makeVariableDeclaration(
    false,
    false,
    `selector`,
    scope,
    false,
    DataLocation.Default,
    StateVariableVisibility.Default,
    Mutability.Mutable,
    "uint256",
    undefined,
    factory.makeTypeNameUint256()
  );
  return selectorDeclaration;
}

function toDeclarationStatement(
  factory: ASTNodeFactory,
  declarations: VariableDeclaration[],
  initialValue: Expression
): VariableDeclarationStatement {
  return factory.makeVariableDeclarationStatement(
    declarations.map((d) => d.id),
    declarations,
    initialValue
  );
}

function getCalldataReadExpression(factory: ASTNodeFactory, type: TypeNode): FunctionCall {
  const cdStart = factory.makeIdentifier("CalldataPointer", "CalldataStart", -1);
  let cdPtr: Expression;
  const parameterOffset = type.calldataHeadOffset;
  if (parameterOffset > 0) {
    const cdOffset = factory.makeMemberAccess("tuple(uint256)", cdStart, "offset", -1);
    const offsetCall = factory.makeFunctionCall("", FunctionCallKind.FunctionCall, cdOffset, [
      factory.makeLiteralUint256(type.calldataHeadOffset)
    ]);
    cdPtr = offsetCall;
  } else {
    cdPtr = cdStart;
  }
  const cdRead = factory.makeMemberAccess(
    "tuple()",
    cdPtr,
    `read${type.identifier[0].toUpperCase() + type.identifier.slice(1)}`,
    -1
  );
  const readCall = factory.makeFunctionCall("", FunctionCallKind.FunctionCall, cdRead, []);
  return readCall;
}

/* function getInheritedInterfaces(factory: ASTNodeFactory, contract: ContractDefinition) {
  const interfaces = contract.vLinearizedBaseContracts.map((base, i) => {
    const inheritanceSpecifier = contract.vInheritanceSpecifiers[i];
  });
}

function copyInterface(
  factory: ASTNodeFactory,
  inheritingContract: ContractDefinition,
  interfaceContract: ContractDefinition
) {
  for (const def of interfaceContract.vLinearizedBaseContracts) {
    const baseContract = factory.getContractDefinitionById(def);
    if (baseContract === undefined) {
      continue;
    }
    if (baseContract.kind === ContractKind.Interface) {
      copyInterface(factory, inheritingContract, baseContract);
    }
  }
} */

type SearchOptions = {
  makeFallbacksInternal?: boolean;
};
enum EmptyFallbackMutability {}
type SearchResults = {
  fallbackByContract: Map<ContractDefinition, FunctionDefinition>;
  receiveByContract: Map<ContractDefinition, FunctionDefinition>;
  emptyFallbackMutabilityByContract: Map<ContractDefinition, FunctionStateMutability>;
  interfaceFunctionSignatures: Set<string>;
  // Map from function signature to all functions with that signature
  functionsBySignature: Map<string, FunctionDefinition[]>;
};

// function createInternalFunctionWrapper(
//   factory: ASTNodeFactory,
//   contract: ContractDefinition,
//   internalFunction: FunctionDefinition
// ): FunctionDefinition {
//   const overrides = resolveOverriddenFunctions(internalFunction);

//   // Note: Does not copy the modifiers of the internal function
//   const wrapper = factory.makeFunctionDefinition(
//     contract.id,
//     FunctionKind.Function,
//     getUniqueNameInScope(contract, internalFunction.name, "_"),
//     internalFunction.virtual,
//     FunctionVisibility.External,
//     internalFunction.stateMutability,
//     false,
//     factory.copy(internalFunction.vParameters),
//     factory.copy(internalFunction.vReturnParameters),
//     [],
//     internalFunction.vOverrideSpecifier && factory.copy(stateVariable.vOverrideSpecifier),
//     body
//   );
//   wrapper.visibility = FunctionVisibility.Internal;
//   wrapper.name = nameGen.getNameFor(wrapper);
//   contract.insertAfter(internalFunction, wrapper);
//   return wrapper;
// }

// /**
//  * Convert a public function to an internal/external function pair.
//  * If the public function overrides another public function in a base contract,
//  * we need to keep the override specifier on both the internal and external functions.
//  *
//  */
// function wrapInternalFunction(internalFn: FunctionDefinition) {
//   const factory = new ASTNodeFactory(internalFn.requiredContext);
//   const externalFn = factory.copy(internalFn);
//   externalFn.visibility = FunctionVisibility.External;
// }

// /**
//  * When we find a public state variable with an override, the only thing that can
//  * be overridden is an external function in a base contract.
//  *
//  * To replace the variable's getter function, we need to:
//  * 1. Create a new external function with the signature of the getter.
//  * 2. Set the function's overrideSpecifier to a copy of the variable's
//  * 3. Rename the variable, adding underscore prefixes until we get a unique identifier.
//  * 4. Set the variable's visibility to `internal`
//  * 5. Find all identifiers referencing the variable and replace their `name` with the new name
//  */
// export function renamePublicFunctions(
//   search: ASTSearch
// ): Array<[VariableDeclaration, FunctionDefinition]> {
//   const publicFunctions = search.findFunctionsByVisibility(FunctionVisibility.Public);
//   return publicFunctions.map((fn) => {
//     fn.name = getUniqueNameInScope(fn, fn.name, "_");
//     fn.visibility = FunctionVisibility.Internal;

//     const references = getReferencesToFunctionOrVariable(search, fn);
//     for (const ref of references) {
//       if (ref instanceof MemberAccess) {
//         ref.memberName = stateVariable.name;
//       } else {
//         ref.name = stateVariable.name;
//       }
//     }
//     return [decl, makeStateVariableGetter(search, decl)];
//   });
// }

function getAllFunctions(factory: ASTNodeFactory, originalContract: ContractDefinition) {
  const functionsBySignature = new Map<string, FunctionDefinition[]>();
  const interfaceFunctionSignatures = new Set<string>();
  const fallbackByContract = new Map<ContractDefinition, FunctionDefinition>();
  const receiveByContract = new Map<ContractDefinition, FunctionDefinition>();
  const baseContracts = [...originalContract.vLinearizedBaseContracts];
  const emptyFallbackMutabilityByContract = new Map<ContractDefinition, FunctionStateMutability>();

  const [interfaces, contracts] = _.partition(
    baseContracts,
    (c) => c.kind === ContractKind.Interface
  );

  for (const iface of interfaces) {
    for (const fn of iface.vFunctions) {
      const signature = fn.canonicalSignatureHash(ABIEncoderVersion.V2);
      interfaceFunctionSignatures.add(signature);
    }
  }

  // Reverse linearized contracts to start with the most derived contract
  contracts.reverse();

  // Remove all fallback functions in parents. For any fallbacks that are not empty, change their
  // name to `_fallback` and change their visibility to internal. Keep track of which contracts
  // have empty fallbacks (meaning they allow arbitrary calls to their address)
  for (let i = 0; i < contracts.length; i++) {
    const contract = contracts[i];
    let fallback: FunctionDefinition | undefined;
    let receive: FunctionDefinition | undefined;
    for (const fn of contract.vFunctions) {
      if (fn.isConstructor) continue;
      if (fn.kind === FunctionKind.Fallback) {
        // If fallback is not empty, change its name to `_fallback` and set it as the last fallback
        // If `lastFallback` is not undefined, add an override for it
        if (fn.vBody?.vStatements?.length) {
          if (fn.vParameters.vParameters.length) {
            throw Error(
              [
                `Fallback function with parameters in ${contract.name} - not currently supported`,
                `Consider using msg.data and assembly returns instead`
              ].join("\n")
            );
          }
          fn.kind = FunctionKind.Function;
          fn.name = "_fallback";
          fn.virtual = true;
          fn.visibility = FunctionVisibility.Internal;
          const previousFallbacks = contract.vLinearizedBaseContracts
            .slice(1)
            .filter((parent) => fallbackByContract.has(parent))
            .map((parent) => fallbackByContract.get(parent) as FunctionDefinition);
          if (previousFallbacks.length > 0) {
            const overrides =
              previousFallbacks.length > 1
                ? previousFallbacks.map((f) =>
                    factory.makeUserDefinedTypeName("", (f.vScope as ContractDefinition).name, f.id)
                  )
                : [];
            fn.vOverrideSpecifier = factory.makeOverrideSpecifier(overrides);
          }
          fallback = fn;
        } else {
          emptyFallbackMutabilityByContract.set(contract, fn.stateMutability);
        }
      } else if (fn.kind === FunctionKind.Receive) {
        receive = fn;
      } else if (isExternalFunction(fn)) {
        const signature = fn.canonicalSignatureHash(ABIEncoderVersion.V2);
        if (interfaceFunctionSignatures.has(signature)) {
          continue;
        }
        if (!functionsBySignature.has(signature)) {
          functionsBySignature.set(signature, []);
        }
        const existing = functionsBySignature.get(signature)!;
        existing.push(fn);
      }
    }
    if (fallback) {
      fallbackByContract.set(contract, fallback);
    } else {
      const lastParentWithFallback = contract.vLinearizedBaseContracts
        .slice(1)
        .find((parent) => fallbackByContract.has(parent));
      if (lastParentWithFallback) {
        fallbackByContract.set(contract, fallbackByContract.get(lastParentWithFallback)!);
      }
    }
    if (receive) {
      receiveByContract.set(contract, receive);
    } else {
      const lastParentWithReceive = contract.vLinearizedBaseContracts
        .slice(1)
        .find((parent) => fallbackByContract.has(parent));
      if (lastParentWithReceive) {
        receiveByContract.set(contract, fallbackByContract.get(lastParentWithReceive)!);
      }
    }
  }
}

/**
 * To solve for overridden functions in interfaces, we'd need to get every
 * function in the interface, then map each of them to every base contract which
 * overrides it. For every function which overrides it, we'd check if the interface's
 *
 * Step 1. Remove all interfaces from the list of base contracts
 * Step 2. For each interface which defines a struct, enum, error or event,
 *         copy the interface with just those.
 *
 * 1. Find all functions in the interface
 * 2. Find all functions in the base contracts which override each
 */

function replaceParameterDeclarations(
  factory: ASTNodeFactory,
  fn: FunctionDefinition,
  decoderSourceUnit: SourceUnit,
  removeParameters?: boolean,
  replaceReturnStatements?: boolean
) {
  const fnType = functionDefinitionToTypeNode(fn);
  const parameters = [...fn.vParameters.vParameters];
  for (let i = 0; i < parameters.length; i++) {
    const param = parameters[i];
    const type = (fnType.parameters as TupleType).vMembers[i];
    if (param.name) {
      if (type.isReferenceType) {
        throw Error(
          `Unexpected reference-type parameter ${type.canonicalName} in ${fn.name}.` +
            `Reference types must already be removed prior to generating function selector switch.`
        );
      }
      const readCall = getCalldataReadExpression(factory, type);
      const newParam = factory.copy(param);
      fn.vBody?.insertAtBeginning(toDeclarationStatement(factory, [newParam], readCall));
    }
    if (removeParameters) {
      fn.vParameters.removeChild(param);
    } else {
      param.name = "";
    }
  }

  if (removeParameters && parameters.length > 0) {
    const docString = (fnType.parameters as TupleType).vMembers
      .map((m) => m.writeParameter(DataLocation.CallData))
      .join(", ");
    const paramsDoc = factory.makeStructuredDocumentation(docString);
    paramsDoc.useJsDocFormat = true;
    fn.vParameters.appendChild(paramsDoc as any);
  }

  if (replaceReturnStatements && fn.vReturnParameters.vParameters.length) {
    const returnFnName = NameGen.return(fnType.returnParameters as TupleType);

    const returnFn = decoderSourceUnit.getChildrenBySelector(
      (n) => n instanceof FunctionDefinition && n.name === returnFnName
    )[0];
    assert(returnFn !== undefined, `Could not find return function ${returnFnName}`);
    replaceReturnStatementsWithCall(fn, returnFn as FunctionDefinition, removeParameters);
  }
}

export function upgradeFunctionCoders(
  contract: ContractDefinition,
  decoderSourceUnit: SourceUnit,
  replaceReturnStatements?: boolean
): void {
  const externalFunctions = contract.vFunctions.filter(
    (fn) => isExternalFunction(fn) && !dependsOnCalldataLocation(fn)
  );
  console.log(`Found ${externalFunctions.length} external functions`);
  if (externalFunctions.length === 0) return;
  addImports(getParentSourceUnit(contract), decoderSourceUnit, []);
  const ctx = contract.requiredContext;
  const factory = new ASTNodeFactory(ctx);
  for (const fn of externalFunctions) {
    if (fn.isConstructor || fn.visibility !== FunctionVisibility.External) continue;
    console.log(`Replacing coders in ${contract.name} ${fn.name} `);
    replaceParameterDeclarations(factory, fn, decoderSourceUnit, false, replaceReturnStatements);
  }
}

/**
 * Generate a function selector switch as a fallback function and
 * add it to `contract`.
 */
export function getFunctionSelectorSwitch(
  contract: ContractDefinition,
  decoderSourceUnit: SourceUnit,
  replaceReturnStatements?: boolean
): void {
  const externalFunctions = contract.vFunctions.filter(
    (fn) => isExternalFunction(fn) && !dependsOnCalldataLocation(fn)
  );
  console.log(`Found ${externalFunctions.length} external functions`);
  if (externalFunctions.length === 0) return;
  addImports(getParentSourceUnit(contract), decoderSourceUnit, []);
  const ctx = contract.requiredContext;
  const factory = new ASTNodeFactory(ctx);
  const body = staticNodeFactory.makeBlock(ctx, []);
  contract.appendChild(
    factory.makeFunctionDefinition(
      contract.id,
      FunctionKind.Fallback,
      `fallback`,
      true,
      FunctionVisibility.External,
      FunctionStateMutability.Payable,
      false,
      factory.makeParameterList([]),
      factory.makeParameterList([]),
      [],
      undefined,
      body
    )
  );
  const selectorDeclaration = getFunctionSelectorDeclaration(factory, body.id);
  body.appendChild(
    toDeclarationStatement(
      factory,
      [selectorDeclaration],
      factory.makeIdentifier("uint256", "uint256(uint32(msg.sig))", -1)
    )
  );
  const msgSelector = factory.makeIdentifierFor(selectorDeclaration);
  for (const fn of externalFunctions) {
    if (fn.isConstructor || fn.visibility !== FunctionVisibility.External) continue;
    let canMakeInternal = true;
    if (fn.vOverrideSpecifier) {
      const overridden = resolveOverriddenFunctions(fn);
      if (
        overridden.some((fn) => (fn.vScope as ContractDefinition).kind === ContractKind.Interface)
      ) {
        console.log(
          err(
            `Skipping ${fn.name} in function dispatch because it overrides an interface function.`,
            `Resolving this is not currently supported.`
          )
        );
        canMakeInternal = false;
      }
    }
    if (canMakeInternal) {
      const selector = staticNodeFactory.makeLiteral(
        ctx,
        "",
        LiteralKind.Number,
        "",
        `0x${fn.canonicalSignatureHash(ABIEncoderVersion.V2)}`
      );
      body.appendChild(
        factory.makeIfStatement(
          factory.makeBinaryOperation("bool", "==", factory.copy(msgSelector), selector),
          factory.makeReturn(0, makeFunctionCallFor(fn, []))
        )
      );
      fn.visibility = FunctionVisibility.Internal;
      fn.stateMutability = FunctionStateMutability.NonPayable;
    }
    console.log(`Adding ${fn.name} to function selector switch`);
    replaceParameterDeclarations(
      factory,
      fn,
      decoderSourceUnit,
      canMakeInternal,
      replaceReturnStatements
    );
  }
}
