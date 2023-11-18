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

const paramTypesToMembers = (params: ParamType[], fragments: JsonFragmentType[]): TypeNode[] => {
  return params.map((param, i) => fromParamType(param, fragments[i]));
};

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

function errorFragmentToTypeNode(fn: ErrorFragment, jsonFragment: JsonFragment) {
  let parameters: TupleType | undefined;
  if (fn.inputs?.length) {
    const members = paramTypesToMembers(fn.inputs, jsonFragment.inputs as JsonFragmentType[]);
    parameters = new TupleType(members);
  }

  return new ErrorType(fn.name, parameters);
}

function eventFragmentToTypeNode(fn: EventFragment, jsonFragment: JsonFragment) {
  let parameters: TupleType | undefined;
  if (fn.inputs?.length) {
    const members = paramTypesToMembers(fn.inputs, jsonFragment.inputs as JsonFragmentType[]);
    parameters = new TupleType(members);
  }

  return new EventType(fn.name, parameters, jsonFragment.anonymous);
}

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
