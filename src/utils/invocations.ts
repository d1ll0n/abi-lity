/**
 * Function and modifier invocation analysis utilities.
 *
 * Extracts structured information about function calls and modifier
 * invocations from a FunctionDefinition, normalizing named arguments
 * and handling member-access call patterns.
 */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  ASTNode,
  ASTSearch,
  ContractDefinition,
  Expression,
  FunctionCall,
  FunctionCallOptions,
  FunctionDefinition,
  MemberAccess,
  ModifierDefinition,
  ModifierInvocation
} from "solc-typed-ast";

/** Returns the constructor that would be invoked for `contract`, walking the linearized base list. */
export function getInvokedConstructor(
  contract: ContractDefinition
): FunctionDefinition | undefined {
  return contract.vLinearizedBaseContracts.find((contract) => !!contract.vConstructor)
    ?.vConstructor;
}

/** Normalized representation of a function call or modifier invocation with resolved arguments. */
export type Invocation = {
  // original invocation ast node id
  invocation: FunctionCall | ModifierInvocation;
  definition: FunctionDefinition | ModifierDefinition;
  arguments: Expression[];
};

/** Collects all modifier invocations and function calls within a FunctionDefinition. */
export function getFunctionsAndModifierInvocations(fn: FunctionDefinition): Invocation[] {
  const invocations: Invocation[] = [];
  if (fn.vModifiers) {
    const modifierInvocations = fn.vModifiers.map((mod) => {
      const modifier = mod.vModifier;
      let fn: FunctionDefinition | ModifierDefinition;
      if (modifier instanceof ContractDefinition) {
        const _constructor = getInvokedConstructor(modifier);
        if (_constructor) {
          fn = _constructor;
        } else {
          return undefined;
        }
      } else {
        fn = modifier;
      }
      return {
        invocation: mod,
        definition: fn,
        arguments: mod.vArguments
      };
    });
    invocations.push(...(modifierInvocations.filter((inv) => inv !== undefined) as Invocation[]));
  }
  if (fn.vBody) {
    const functionCalls = ASTSearch.from(fn.vBody).find("FunctionCall");
    invocations.push(
      ...(functionCalls
        .map((call) => {
          return {
            invocation: call,
            definition: call.vReferencedDeclaration,
            arguments: call.vArguments
          };
        })
        .filter((invoc) => invoc.definition !== undefined) as Invocation[])
    );
  }
  return invocations;
}

type FnCall = {
  fn: FunctionDefinition;
  call: FunctionCall;
  vExpression: Expression;
  vArguments: Expression[];
};

/**
 * Normalizes a FunctionCall into a FnCall with ordered arguments.
 * Handles named arguments by reordering to match parameter declaration order,
 * and prepends the receiver for member-access calls.
 */
export const functionCallToFnCall = (call: FunctionCall): FnCall | undefined => {
  const args: Expression[] = [];
  const expression = call.vExpression;
  const fn = call.vReferencedDeclaration;
  if (!(fn instanceof FunctionDefinition)) return undefined;
  if (expression instanceof MemberAccess) {
    args.push(expression.vExpression);
  }
  if (call.fieldNames) {
    const functionParameters = fn.vParameters.vParameters.map((param) => param.name);
    if (expression instanceof MemberAccess) {
      functionParameters.shift();
    }
    const orderedArgs = functionParameters.map((paramName) => {
      const argIndex = call.fieldNames!.indexOf(paramName);
      return call.vArguments[argIndex];
    });
    args.push(...orderedArgs);
  } else {
    args.push(...call.vArguments);
  }
  return {
    fn,
    call,
    vExpression: expression,
    vArguments: args
  };
};

function getFunctionCalls(node: ASTNode) {
  const functionCalls = node.getChildrenByType(FunctionCall);
  const functionCallOptions = node.getChildrenByType(FunctionCallOptions);
}
