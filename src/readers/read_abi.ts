/**
 * JSON ABI reader — converts ethers v5 ABI fragments into abi-lity TypeNodes.
 *
 * This module parses standard Solidity JSON ABI (the format used by etherscan, compiled
 * artifacts, and interface files) without requiring source code or a compiler.
 *
 * Uses ethers v5's `Interface` class to parse the JSON, then converts the resulting
 * `ParamType` trees to abi-lity TypeNodes. Nested structs and enums are automatically
 * discovered during recursive type traversal.
 *
 * Limitations:
 * - Enum member names are not available in ABI JSON — placeholder members are created
 * - No access to NatSpec documentation
 * - The `internalType` field is used heuristically to detect struct/enum names
 *
 * @see docs/readers.md for when to use this reader vs the others.
 */
import {
  ErrorFragment,
  EventFragment,
  FunctionFragment,
  Interface,
  JsonFragment,
  JsonFragmentType,
  ParamType,
  Fragment
} from "@ethersproject/abi";
import _ from "lodash";
import { FunctionStateMutability, FunctionVisibility } from "solc-typed-ast";
import {
  ArrayType,
  EnumType,
  ErrorType,
  EventType,
  FunctionType,
  StructType,
  TupleType,
  TypeNode
} from "../ast";
import { ASTContext } from "../ast/ast_context";
import { elementaryTypeStringToTypeNode } from "./elementary";
import { TypeNodeReaderResult } from "./types";

/**
 * Recursively converts an ethers `ParamType` to an abi-lity TypeNode.
 *
 * Dispatch logic:
 * - `baseType === "tuple"` → Creates `StructType` (if `internalType` starts with "struct")
 *   or `TupleType`, then recurses into components
 * - `baseType === "array"` → Creates `ArrayType` and recurses into `arrayChildren`
 * - Otherwise → checks `internalType` for enum heuristic, falls back to `elementaryTypeStringToTypeNode()`
 *
 * @param param - Ethers ParamType (parsed from ABI JSON)
 * @param fragment - The raw JSON fragment, used to access `internalType` and `components`
 */
function fromParamType(param: ParamType, fragment: JsonFragmentType): TypeNode {
  if (param.baseType === "tuple") {
    if (fragment === undefined || fragment.components === undefined) {
      throw Error(`Fragment components not defined for ${param.name}`);
    }
    const members = paramTypesToMembers(param.components, fragment?.components as JsonFragment[]);
    let type: TupleType | StructType;
    if (fragment.internalType) {
      const name = fragment.internalType.replace("struct ", "");
      // console.log(`Creating struct type ${name}`);
      type = new StructType(members, name);
    } else {
      type = new TupleType(members);
    }
    type.labelFromParent = param.name;
    type.isIndexed = param.indexed;
    return type;
  } else if (param.baseType === "array") {
    const _fragment = {
      ...fragment,
      internalType: fragment.internalType.replace("[]", ""),
      type: fragment.type?.replace("[]", "")
    };
    const baseType = fromParamType(param.arrayChildren, _fragment);
    const length = Math.max(param.arrayLength, 0) || undefined;
    const array = new ArrayType(baseType, length);
    array.labelFromParent = param.name;
    array.isIndexed = param.indexed;
    return array;
  } else {
    if (fragment.internalType?.includes("enum")) {
      const type = new EnumType(fragment.internalType.replace("enum ", ""), [
        `UnknownMember1`,
        `UnknownMember2`
      ]);
      type.labelFromParent = param.name;
      type.isIndexed = param.indexed;
      return type;
    }
    const elementary = elementaryTypeStringToTypeNode(param.baseType);
    elementary.labelFromParent = param.name;
    elementary.isIndexed = param.indexed;
    return elementary;
  }
}

/** Zips parallel `ParamType[]` and `JsonFragmentType[]` arrays, converting each pair via `fromParamType()`. */
const paramTypesToMembers = (params: ParamType[], fragments: JsonFragmentType[]): TypeNode[] => {
  return params.map((param, i) => fromParamType(param, fragments[i]));
};

/**
 * Converts an ethers `FunctionFragment` to a `FunctionType`.
 *
 * All ABI functions are assumed `External` visibility. State mutability is
 * taken directly from the fragment (view, pure, payable, nonpayable).
 */
function functionFragmentToTypeNode(fn: FunctionFragment, jsonFragment: JsonFragment) {
  let parameters: TupleType | undefined;
  let returnParameters: TupleType | undefined;
  if (fn.inputs?.length) {
    const members = paramTypesToMembers(fn.inputs, [
      ...(jsonFragment?.inputs ?? [])
    ] as JsonFragmentType[]);
    parameters = new TupleType(members);
  }
  if (fn.outputs?.length) {
    const members = paramTypesToMembers(fn.outputs, [
      ...(jsonFragment.outputs ?? [])
    ] as JsonFragmentType[]);
    returnParameters = new TupleType(members);
  }
  return new FunctionType(
    fn.name,
    parameters,
    returnParameters,
    FunctionVisibility.External,
    fn.stateMutability as FunctionStateMutability
  );
}

/** Converts an ethers `ErrorFragment` to an `ErrorType` with optional parameter tuple. */
function errorFragmentToTypeNode(fn: ErrorFragment, jsonFragment: JsonFragment) {
  let parameters: TupleType | undefined;
  if (fn.inputs?.length) {
    const members = paramTypesToMembers(fn.inputs, jsonFragment.inputs as JsonFragmentType[]);
    parameters = new TupleType(members);
  }

  return new ErrorType(fn.name, parameters);
}

/** Converts an ethers `EventFragment` to an `EventType`, preserving the `anonymous` flag. */
function eventFragmentToTypeNode(fn: EventFragment, jsonFragment: JsonFragment) {
  let parameters: TupleType | undefined;
  if (fn.inputs?.length) {
    const members = paramTypesToMembers(fn.inputs, jsonFragment.inputs as JsonFragmentType[]);
    parameters = new TupleType(members);
  }

  return new EventType(fn.name, parameters, jsonFragment.anonymous);
}

/**
 * Orchestrates ABI parsing and recursively collects all discovered types.
 *
 * Wraps ethers v5's `Interface` to iterate over parsed fragments. As top-level
 * types (functions, errors, events) are added via `addTypeNode()`, the method
 * recursively walks their parameter trees to discover nested `StructType` and
 * `EnumType` instances, deduplicating structs by name.
 *
 * All collected TypeNodes are registered in the shared `ASTContext`.
 */
class InterfaceTypes {
  interface: Interface;
  functions: FunctionType[] = [];
  structs: StructType[] = [];
  events: EventType[] = [];
  errors: ErrorType[] = [];
  enums: EnumType[] = [];

  constructor(protected jsonFragments: JsonFragment[], protected context: ASTContext) {
    this.interface = new Interface(jsonFragments);
  }

  get interfaceFunctions() {
    return Object.values(this.interface.functions);
  }

  get interfaceErrors() {
    return Object.values(this.interface.errors);
  }

  get interfaceEvents() {
    return Object.values(this.interface.events);
  }

  get interfaceStructs() {
    return Object.values(this.interface.structs);
  }

  /**
   * Recursively categorizes a TypeNode and its children into the appropriate collection.
   *
   * Walks the type tree depth-first: compound types (functions, errors, events) are stored
   * in their respective arrays, then their parameter tuples are recursed into. Structs are
   * deduplicated by name. Every node is registered in the shared `context`.
   */
  addTypeNode(node: TypeNode | undefined) {
    if (node instanceof StructType) {
      if (!this.structs.find((s) => s.name === node.name)) {
        this.structs.push(node);
      }
      node.vMembers.forEach((member) => this.addTypeNode(member));
    } else if (node instanceof TupleType) {
      node.vMembers.forEach((member) => this.addTypeNode(member));
    } else if (node instanceof ArrayType) {
      this.addTypeNode(node.baseType);
    } else if (node instanceof ErrorType) {
      this.errors.push(node);
      this.addTypeNode(node.parameters);
    } else if (node instanceof EventType) {
      this.events.push(node);
      this.addTypeNode(node.parameters);
    } else if (node instanceof FunctionType) {
      this.functions.push(node);
      this.addTypeNode(node.parameters);
      this.addTypeNode(node.returnParameters);
    } else if (node instanceof EnumType) {
      this.enums.push(node);
    }
    if (node) {
      node.context = this.context;
    }
  }

  /**
   * Finds the original `JsonFragment` corresponding to a parsed ethers fragment.
   *
   * Matches by comparing the canonical `format()` string of each fragment.
   * Needed because ethers' parsed fragments drop `internalType` and `components`,
   * which are required for struct/enum detection in `fromParamType()`.
   */
  getJsonFragment(fn: FunctionFragment | ErrorFragment | EventFragment) {
    const fragment = this.jsonFragments.find((frag) => {
      return Fragment.from(frag).format() === fn.format();
    });
    if (fragment === undefined) {
      throw Error(`JSON fragment not found for ${name}`);
    }
    return fragment;
  }
}

/**
 * Main entry point: parses a JSON ABI array into abi-lity TypeNodes.
 *
 * Filters out constructor fragments, then iterates all functions, errors, and events
 * from the parsed interface. Nested structs and enums are automatically discovered
 * during recursive traversal of parameter types.
 *
 * @param _jsonFragments - Standard Solidity JSON ABI array (e.g., from etherscan or compiled artifacts)
 * @returns Unified `TypeNodeReaderResult` with all discovered types registered in a shared context
 */
export function readTypeNodesFromABI(_jsonFragments: JsonFragment[]): TypeNodeReaderResult {
  const context = new ASTContext();
  _jsonFragments = _jsonFragments.filter((fn) => fn.type !== "constructor");
  const parser = new InterfaceTypes(_jsonFragments, context);
  for (const fn of parser.interfaceFunctions) {
    const jsonFragment = parser.getJsonFragment(fn);
    parser.addTypeNode(functionFragmentToTypeNode(fn, jsonFragment));
  }
  for (const error of parser.interfaceErrors) {
    const jsonFragment = parser.getJsonFragment(error);
    parser.addTypeNode(errorFragmentToTypeNode(error, jsonFragment));
  }
  for (const event of parser.interfaceEvents) {
    const jsonFragment = parser.getJsonFragment(event);
    parser.addTypeNode(eventFragmentToTypeNode(event, jsonFragment));
  }

  return {
    context,
    functions: parser.functions,
    structs: parser.structs,
    events: parser.events,
    errors: parser.errors,
    enums: parser.enums
  };
}
