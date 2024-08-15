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

const nonGreedyTakeOneOrMore = (...arr: string[]) => [arr, "+?"].join("");

const optionalRepeat = (...arr: string[]) => {
  return [arr, "*"].join("");
};

const repeat = (...arr: string[]) => {
  return [arr, "+"].join("");
};

const variableKindRegex = capture(or("var_", "expr_", "usr\\$"));
const nonGreedyIdentifier = capture(nonGreedyTakeOneOrMore("[\\w\\$]"));
const astIdSuffix = optional(nonCaptureGroup("_", capture("\\d+")));
const memberSuffixOptions = or(
  "offset",
  "length",
  "mpos",
  "slot",
  "address",
  "component_\\d+",
  "functionSelector",
  "functionIdentifier",
  "gas",
  "value",
  "salt",
  "self"
);
const postMemberIdSuffix = optional(nonCaptureGroup("_", capture("\\d+")));
const memberSuffix = optional(
  nonCaptureGroup("_", capture(memberSuffixOptions), postMemberIdSuffix)
);
const functionKindRegex = capture(or("fun_", "external_fun_"));

const varIdentifierRegex = [
  "^",
  variableKindRegex,
  nonGreedyIdentifier,
  astIdSuffix,
  memberSuffix,
  "$"
].join("");
const functionIdentifierRegex = [
  "^",
  functionKindRegex,
  nonGreedyIdentifier,
  astIdSuffix,
  "$"
].join("");
/*
var_ or expr_ or usr$
(?:(?:(var|expr)_)|usr\$)
identifier
([\w\$]+?)
ast id suffix
(?:_([0-9]+))?
suffix
(?:_(offset|length|mpos|slot|address|component_\d+|functionSelector|functionIdentifier|gas|value|salt|self)(?:_(\d*)?))?

*/
//(?:(?:(var|expr)_)|usr\\$)

const examples: Array<{
  text: string;
  expected: ParsedIdentifier;
}> = [
  {
    text: "var_fun_$getUpdatedState_offset_2_999_self_99",
    expected: {
      kind: "var",
      originalName: "fun_$getUpdatedState_offset_2",
      astId: "999",
      suffix: "self",
      postSuffixId: "99"
    }
  },
  {
    text: "expr_struct_mpos",
    expected: {
      kind: "expr",
      originalName: "struct",
      suffix: "mpos"
    }
  },
  {
    text: "expr_struct_2_mpos",
    expected: {
      kind: "expr",
      originalName: "struct",
      astId: "2",
      suffix: "mpos"
    }
  },
  {
    text: "expr_struct_2_mpos_1",
    expected: {
      kind: "expr",
      originalName: "struct",
      astId: "2",
      suffix: "mpos",
      postSuffixId: "1"
    }
  },
  {
    text: "fun_struct_2_mpos_1",
    expected: {
      kind: "fun",
      originalName: "struct_2_mpos",
      astId: "1"
    }
  },
  {
    text: "external_fun_struct_2_mpos_1",
    expected: {
      kind: "external_fun",
      originalName: "struct_2_mpos",
      astId: "1"
    }
  },
  {
    text: "expr_struct_2_component_2_99",
    expected: {
      kind: "expr",
      originalName: "struct",
      astId: "2",
      suffix: "component_2",
      postSuffixId: "99"
    }
  },
  {
    text: "usr$_fun_var_someFunction$_slot",
    expected: {
      kind: "usr$",
      originalName: "_fun_var_someFunction$",
      suffix: "slot"
    }
  },
  {
    text: "usr$_some_expr_component_10_9",
    expected: {
      kind: "usr$",
      originalName: "_some_expr",
      suffix: "component_10",
      postSuffixId: "9"
    }
  }
];

type ParsedIdentifier = {
  kind?: string;
  originalName?: string;
  astId?: string;
  suffix?: string;
  postSuffixId?: string;
};

export const parseYulIdentifier = (text: string): ParsedIdentifier => {
  const [, kind, originalName, astId, suffix, postSuffixId] =
    new RegExp(
      text.startsWith("fun") || text.startsWith("external_fun_")
        ? functionIdentifierRegex
        : varIdentifierRegex
    ).exec(text) ?? [];
  return {
    kind: kind?.replace(/_$/, ""),
    originalName,
    astId,
    suffix,
    postSuffixId
  };
};

function testRegex() {
  for (const { text, expected } of examples) {
    const result = parseYulIdentifier(text);
    for (const key of ["kind", "originalName", "astId", "suffix", "postSuffixId"] as const) {
      if (result[key] !== expected[key]) {
        console.log({ key, result: result[key], expected: expected[key] });
      }
    }
  }
}
