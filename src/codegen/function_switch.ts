import {
  assert,
  ASTNodeFactory,
  ContractDefinition,
  DataLocation,
  Expression,
  FunctionCall,
  FunctionCallKind,
  FunctionDefinition,
  FunctionKind,
  FunctionStateMutability,
  FunctionVisibility,
  InferType,
  LatestCompilerVersion,
  LiteralKind,
  Mutability,
  SourceUnit,
  StateVariableVisibility,
  staticNodeFactory,
  VariableDeclaration,
  VariableDeclarationStatement
} from "solc-typed-ast";
import { TupleType, TypeNode } from "../ast";
import { functionDefinitionToTypeNode } from "../readers";
import { addImports, getParentSourceUnit, makeFunctionCallFor, isExternalFunction } from "../utils";
import {
  createReturnFunctionForReturnParameters,
  replaceReturnStatementsWithCall
} from "./abi_encode";
import { dependsOnCalldataLocation } from "./utils";
import NameGen from "./names";

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

const infer = new InferType(LatestCompilerVersion);

/**
 * Generate a function selector switch as a fallback function and
 * add it to `contract`.
 */
export function getFunctionSelectorSwitch(
  contract: ContractDefinition,
  decoderSourceUnit: SourceUnit
): void {
  const externalFunctions = contract.vFunctions.filter(
    (fn) => isExternalFunction(fn) && !dependsOnCalldataLocation(fn)
  );
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

    const selector = staticNodeFactory.makeLiteral(
      ctx,
      "",
      LiteralKind.Number,
      "",
      `0x${infer.signatureHash(fn)}`
    );
    body.appendChild(
      factory.makeIfStatement(
        factory.makeBinaryOperation("bool", "==", factory.copy(msgSelector), selector),
        factory.makeReturn(0, makeFunctionCallFor(fn, []))
      )
    );
    fn.visibility = FunctionVisibility.Internal;
    fn.stateMutability = FunctionStateMutability.NonPayable;
    const parameters = [...fn.vParameters.vParameters];
    // if (parameters.length === 0) continue;
    const fnType = functionDefinitionToTypeNode(fn);
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
      fn.vParameters.removeChild(param);
    }
    if (parameters.length > 0) {
      const docString = (fnType.parameters as TupleType).vMembers
        .map((m) => m.writeParameter(DataLocation.CallData))
        .join(", ");
      const paramsDoc = factory.makeStructuredDocumentation(docString);
      paramsDoc.useJsDocFormat = true;
      fn.vParameters.appendChild(paramsDoc as any);
    }
    if (fn.vOverrideSpecifier) {
      const overrides = fn.vOverrideSpecifier.vOverrides;
      if (overrides.length === 0) {
        console.log(`${fn.name} has no override data`);
      }
      fn.vOverrideSpecifier = undefined;
    }
    if (fn.vReturnParameters.vParameters.length) {
      const returnFnName = NameGen.return(fnType.returnParameters as TupleType);

      let returnFn = decoderSourceUnit.getChildrenBySelector(
        (n) => n instanceof FunctionDefinition && n.name === returnFnName
      )[0];
      if (!returnFn) {
        returnFn = createReturnFunctionForReturnParameters(
          factory,
          fn.vReturnParameters,
          fnType,
          decoderSourceUnit
        );
      }
      replaceReturnStatementsWithCall(fn, returnFn as FunctionDefinition);
    }
  }
}
