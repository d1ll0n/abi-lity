import {
  DataLocation,
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

const parseModifiers = (_modifiers: string) =>
  _modifiers

    .split(/\s+/)
    .filter(Boolean)
    .map((x) => x.replace(/\s\s+/g, " ").trim());

// const parseParamsList = (_params: string) =>
//   _params.split(",").map((x) => x.replace(/\s\s+/g, " ").trim());

function parseFunctionVariable(variable: string) {
  const re = new RegExp(FunctionVariable);
  const result = re.exec(variable);
  if (!result) {
    return undefined;
  }
  const [, _params, _modifiers, _returns, name] = result;
  const modifiers = parseModifiers(_modifiers);
  const params = parseParamsList(_params);
  const returns = parseParamsList(_returns);
  let visibility = FunctionVisibility.Default;
  let mutability = FunctionStateMutability.NonPayable;
  const actualModifiers = [];
  for (const i in modifiers) {
    modifiers[i];
  }
  for (const modifier of modifiers) {
    if (PossibleFunctionVisibilities.has(modifier)) {
      visibility = modifier as FunctionVisibility;
    } else if (PossibleFunctionStateMutabilities.has(modifier)) {
      mutability = modifier as FunctionStateMutability;
    } else {
      actualModifiers.push(modifier);
    }
  }
  return {
    params,
    modifiers: actualModifiers,
    returns,
    name,
    visibility,
    mutability
  };
}

const BaseVariable = [
  // capture(FunctionVariable),
  // nonCaptureGroup(or(nonCaptureGroup(...getFunctionVariableType(true)), capture(Identifier))),
  capture(Identifier),
  optional(
    nonCaptureGroup(OptionalWhiteSpace),
    capture(
      "\\[",
      nonCaptureGroup(OptionalWhiteSpace),
      optional(capture("\\d+")),
      nonCaptureGroup(OptionalWhiteSpace),
      "\\]"
    )
    // capture(paren(BalancedSquareBrackets))
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

  const unwrappedParams = parseParamsList(params);
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

enum ParameterKind {
  Function = "Function",
  Elementary = "Elementary",
  Array = "Array",
  UserDefinedValueType = "UserDefinedValueType",
  UserDefinedReferenceType = "UserDefinedReferenceType"
}

type FunctionParameter = {
  kind: ParameterKind.Function;
  name: string;
  params: ParameterType[];
  returns: ParameterType[];
  visibility: FunctionVisibility;
  mutability: FunctionStateMutability;
};

type ElementaryParameter = {
  kind: ParameterKind.Elementary;
  type: string;
  name: string;
};

type UserDefinedValueTypeParameter = {
  kind: ParameterKind.UserDefinedValueType;
  type: string;
  name: string;
};

type UserDefinedReferenceTypeParameter = {
  kind: ParameterKind.UserDefinedReferenceType;
  type: string;
  name: string;
  location: DataLocation;
};

type ArrayParameter = {
  kind: ParameterKind.Array;
  baseType: string;
  name: string;
  location: DataLocation;
  length?: string;
};

type ParameterType =
  | FunctionParameter
  | ElementaryParameter
  | UserDefinedValueTypeParameter
  | UserDefinedReferenceTypeParameter
  | ArrayParameter;

const parseParameter = (parameter: string): any => {
  if (parameter.includes("(")) {
    return parseFunctionVariable(parameter);
  }
  const re = new RegExp(BaseVariable.join(""));
  const result = re.exec(parameter);
  if (!result) {
    return undefined;
  }
  const [, type, _isArray, arrayLength, _location, name] = result;
  const isArray = !!_isArray;
  const location = toLocation(_location);

  if (isArray) {
    const length = arrayLength && +arrayLength;
    return {
      kind: ParameterKind.Array,
      baseType: parseParameter(type),
      name,
      location,
      length
    };
  }
  return {
    type,
    isArray: !!isArray,
    arrayLength,
    location,
    name
  };
};

function parseParamsList(params: string): any[] {
  const inner = params.split(unbalancedParentheses).map((x) => x.trim());
  const result = [];
  for (const param of inner) {
    if (param.includes("(")) {
      result.push(parseFunctionVariable(param));
    } else {
      console.log(`<<--param---`);
      console.log(param);
      console.log(new RegExp(BaseVariable.join(""), "g").exec(param));
      console.log(`>>---param---`);
      result.push(param);
    }
  }
  return result;
}

const toLocation = (location: string) => {
  if (PossibleDataLocations.has(location)) {
    return location as DataLocation;
  }
  return DataLocation.Default;
};

const toVisibility = (visibility: string) => {
  if (PossibleFunctionVisibilities.has(visibility)) {
    return visibility as FunctionVisibility;
  }
  return FunctionVisibility.Default;
};

const toMutability = (mutability: string) => {
  if (PossibleFunctionStateMutabilities.has(mutability)) {
    return mutability as FunctionStateMutability;
  }
  return FunctionStateMutability.NonPayable;
};

function test1() {
  const code = `function someFn(
    function (uint ) internal pure returns (uint256 ) a,
    uint256 b
  ) internal pure mod(a) returns (uint256) {}`;
  const ts = Date.now();
  const fnLikeRegex = new RegExp(getFnLikeRegex("function", true), "g");
  console.log(fnLikeRegex);
  const result = fnLikeRegex.exec(code);
  console.log(Date.now() - ts);

  if (result) {
    const [, name, _params, _modifiers, _returns] = result;
    const modifiers = parseModifiers(_modifiers);
    const params = parseParamsList(_params);
    const returns = parseParamsList(_returns);
    let visibility = FunctionVisibility.Default;
    let mutability = FunctionStateMutability.NonPayable;
    const actualModifiers = [];
    for (const modifier of modifiers) {
      if (PossibleFunctionVisibilities.has(modifier)) {
        visibility = modifier as FunctionVisibility;
      } else if (PossibleFunctionStateMutabilities.has(modifier)) {
        mutability = modifier as FunctionStateMutability;
      } else {
        actualModifiers.push(modifier);
      }
    }
    console.log(
      JSON.stringify(
        {
          name,
          params,
          modifiers: actualModifiers,
          visibility,
          mutability,
          returns
        },
        null,
        2
      )
    );
  }
}

// function parseVariableResults(result: string[]) {
//   const [, params, modifiers, returns, baseTypeIdentifier, arrayBrackets, location, identifier] =
//     result;
// }
// // test1();
// console.log(
//   new RegExp(BaseVariable.join("")).exec(`uint256[] memory a`),
//   new RegExp(BaseVariable.join("")).exec(
//     `function (uint) internal mod pure returns (uint256[]) memory a`
//   )
//   // parseFunctionVariable(`function (uint) internal mod pure returns (uint256[]) a`)
//   // new RegExp(FunctionVariable).exec(`function (uint) internal mod pure returns (uint256[]) a`)
// );
// // console.log(
// //   new RegExp(capture(Identifier, OptionalWhiteSpace, paren(BalancedParenthesesInner)), "g").exec(
// //     `a((a, b, c))`
// //   )
// // );

// const x = `function (uint) internal mod pure returns (uint256[]) memory a`.match(
//   new RegExp(BaseVariable.join(""))
// );
// test1();

console.log(parseParameter(`uint256 a`));
