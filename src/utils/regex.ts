import {
  FunctionStateMutability,
  FunctionVisibility,
  PossibleDataLocations,
  PossibleFunctionStateMutabilities,
  PossibleFunctionVisibilities
} from "solc-typed-ast";
import { coerceArray } from "./text";

const RequiredWhiteSpace = "\\s+";
const OptionalWhiteSpace = "\\s*";
const LParen = "\\(";
const RParen = "\\)";

const negativeLookBehind = (...arr: string[]) => ["(?<!", ...arr, ")"].join("");
const negativeLookAhead = (...arr: string[]) => ["(?!", ...arr, ")"].join("");

const lookBehind = (...arr: string[]) => ["(?<=", ...arr, ")"].join("");

const nonCaptureGroup = (...arr: string[]) => ["(?:", ...arr, ")"].join("");

const or = (...arr: string[]) => arr.join("|");

const capture = (...arr: string[]) => ["(", ...arr, ")"].join("");

const paren = (...arr: string[]) => [LParen, ...arr, RParen].join("");

const negativeCommentPrefix = ["(?<![/]{2}[^\\n\\r]*)(?<!(?:\\/\\*\\*?(?:(?!*/)(?:.|\\r|\\n))*))"];

const optional = (...arr: string[]) => [...arr, "?"].join("");

const optionalRepeat = (...arr: string[]) => {
  return [arr, "*"].join("");
};

const repeat = (...arr: string[]) => {
  return [arr, "+"].join("");
};

const nonCharacterPrefix = negativeLookBehind("[a-zA-Z0-9-_]");

const NegativeCommentPrefix = negativeLookBehind(`[/]{2}\\s*`);

const FunctionStartCaptureGroup = ["(", "function", RequiredWhiteSpace, ")"];

const FunctionParamStartCaptureGroup = ["(", OptionalWhiteSpace, LParen, OptionalWhiteSpace, ")"];

const BalancedParenthesesInner = "(?:[^)()]+|\\((?:[^)()]+|\\([^)()]*\\))*\\))*?";
const BalancedParentheses = paren(BalancedParenthesesInner);
const BalancedBracketsInner = "(?:[^}{]+|\\{(?:[^}{]+|\\{[^}{]*\\})*\\})*?";
const BalancedSquareBrackets = "(?:[^][]+|\\[(?:[^][]+|\\[[^][]*\\])*\\])*?";
// const BalancedBrackets = ["\\{", BalancedBracketsInner, "\\}"].join("");

const Identifier = "\\b[a-zA-Z0-9-_]+\\b";
const OptionalIdentifier = nonCaptureGroup(Identifier) + "?";
const OptionalArguments = "[\\w|\\d|\\s|,|_-]*"; // "[\\w|\\d|\\s|,|_-]*";

const VariableLocation = nonCaptureGroup(or(...PossibleDataLocations));
const FunctionParamEndCaptureGroup = ["(", OptionalWhiteSpace, RParen, OptionalWhiteSpace, ")"];

const BlockEndCaptureGroup = ["(", "\\}", ")"];

const ReturnParameters = ["returns", OptionalWhiteSpace, BalancedParentheses];

const ModifierWithoutArguments = [
  OptionalWhiteSpace,
  Identifier,
  negativeLookAhead(OptionalWhiteSpace, LParen)
];
const ModifierWithArguments = [
  OptionalWhiteSpace,
  Identifier,
  OptionalWhiteSpace,
  BalancedParentheses
];

const FunctionBlockCaptureGroup = "((?:.|\\s)*)";
const getFunctionVariableType = (innerCapture?: boolean) => {
  const captureFn = innerCapture ? capture : nonCaptureGroup;
  return [
    "function",
    OptionalWhiteSpace,
    paren(OptionalWhiteSpace, captureFn(BalancedParenthesesInner), OptionalWhiteSpace),

    nonCaptureGroup(
      OptionalWhiteSpace,
      captureFn(
        optionalRepeat(
          nonCaptureGroup(
            negativeLookAhead(nonCaptureGroup(OptionalWhiteSpace, ...ReturnParameters)),
            nonCaptureGroup(...ModifierWithoutArguments)
          )
        )
      )
    ),
    optional(
      nonCaptureGroup(
        nonCaptureGroup(OptionalWhiteSpace),
        "returns",
        OptionalWhiteSpace,
        paren(OptionalWhiteSpace, captureFn(BalancedParenthesesInner), OptionalWhiteSpace)
      )
    )
  ];
};
const FunctionVariable = [
  ...getFunctionVariableType(true),
  OptionalWhiteSpace,
  optional(capture(Identifier))
].join("");

function parseFunctionVariable(variable: string) {
  const re = new RegExp(FunctionVariable);
  const result = re.exec(variable);
  if (!result) {
    return undefined;
  }
  const [, params, modifiers, returns, name] = result;
  let visibility = FunctionVisibility.Default;
  let mutability = FunctionStateMutability.NonPayable;
  for (const modifier of modifiers.split(/\s+/).filter(Boolean)) {
    if (PossibleFunctionVisibilities.has(modifier)) {
      visibility = modifier as FunctionVisibility;
    } else if (PossibleFunctionStateMutabilities.has(modifier)) {
      mutability = modifier as FunctionStateMutability;
    } else {
      console.log("Unknown modifier", modifier);
    }
  }
  return {
    params,
    modifiers,
    returns,
    name,
    visibility,
    mutability
  };
}

const BaseVariable = [
  // capture(FunctionVariable),
  nonCaptureGroup(or(nonCaptureGroup(...getFunctionVariableType(true)), capture(Identifier))),

  optional(
    nonCaptureGroup(OptionalWhiteSpace),
    capture("\\[", nonCaptureGroup(BalancedSquareBrackets), "\\]")
  ),

  // capture(
  // capture(or(nonCaptureGroup(...FunctionVariableType), nonCaptureGroup(Identifier))),
  // optional(capture("\\[", BalancedSquareBrackets, "\\]")),
  optional(nonCaptureGroup(OptionalWhiteSpace), capture(VariableLocation)),
  optional(nonCaptureGroup(OptionalWhiteSpace), capture(Identifier))
  // )
];

const getFnLikeRegex = (name: string, captureId?: boolean) =>
  [
    ...(captureId ? [nonCaptureGroup(name, OptionalWhiteSpace), `(${Identifier})`] : [`(${name})`]),
    OptionalWhiteSpace,
    paren(OptionalWhiteSpace, capture(BalancedParenthesesInner), OptionalWhiteSpace),
    OptionalWhiteSpace,
    capture(
      optionalRepeat(
        nonCaptureGroup(
          negativeLookAhead(nonCaptureGroup(OptionalWhiteSpace, ...ReturnParameters)),
          nonCaptureGroup(
            or(
              nonCaptureGroup(...ModifierWithArguments),
              nonCaptureGroup(...ModifierWithoutArguments)
            )
          )
        )
      )
    ),
    OptionalWhiteSpace,
    optional(capture(...ReturnParameters))
  ].join("");

const unbalancedParentheses = new RegExp(
  [
    ",",
    negativeLookAhead(
      or(
        nonCaptureGroup(BalancedParenthesesInner, RParen),
        nonCaptureGroup(LParen, BalancedParenthesesInner)
      )
    )
  ].join("")
);

function unwrapCall(call: string) {
  const regex = new RegExp(
    [
      "^",
      OptionalWhiteSpace,
      optional(capture(Identifier)),
      OptionalWhiteSpace,
      paren(OptionalWhiteSpace, capture(BalancedParenthesesInner), OptionalWhiteSpace),
      OptionalWhiteSpace,
      "$"
    ].join("")
  );
  const result = regex.exec(call);
  if (!result) {
    return undefined;
  }
  const [, identifier, params] = result;

  const unwrappedParams = splitParameters(params);
  if (identifier) {
    return {
      type: "call",
      identifier,
      params: unwrappedParams
    };
  }
  return {
    type: "tuple",
    params: unwrappedParams
  };
}

function splitParameters(params: string): any[] {
  const inner = params.split(unbalancedParentheses).filter(Boolean);
  const result = [];
  for (const param of inner) {
    if (param.includes("(")) {
      result.push(unwrapCall(param));
    } else {
      result.push(param);
    }
  }
  return result;
}

function test1() {
  const code = `function someShit(
    function (uint) internal mod(a) pure returns (uint256) a,
    uint256 b
  ) internal pure mod(a) returns (uint256) {}`;
  const ts = Date.now();
  const fnLikeRegex = new RegExp(getFnLikeRegex("function", true), "g");
  console.log(fnLikeRegex);
  const result = fnLikeRegex.exec(code);
  console.log(Date.now() - ts);

  if (result) {
    const [, name, params, modifiers, returns] = result;
    console.log({
      name,
      params,
      modifiers,
      returns
    });
  }
}

function parseVariableResults(result: string[]) {
  const [, params, modifiers, returns, baseTypeIdentifier, arrayBrackets, location, identifier] =
    result;
}
// test1();
console.log(
  new RegExp(BaseVariable.join("")).exec(`uint256[] memory a`),
  new RegExp(BaseVariable.join("")).exec(
    `function (uint) internal mod pure returns (uint256[]) memory a`
  )
  // parseFunctionVariable(`function (uint) internal mod pure returns (uint256[]) a`)
  // new RegExp(FunctionVariable).exec(`function (uint) internal mod pure returns (uint256[]) a`)
);
// console.log(
//   new RegExp(capture(Identifier, OptionalWhiteSpace, paren(BalancedParenthesesInner)), "g").exec(
//     `a((a, b, c))`
//   )
// );

const x = `function (uint) internal mod pure returns (uint256[]) memory a`.match(
  new RegExp(BaseVariable.join(""))
);
