import {
  ErrorFragment,
  EventFragment,
  FunctionFragment,
  Interface,
  JsonFragment,
  JsonFragmentType,
  ParamType
} from "@ethersproject/abi";
import { FunctionStateMutability, FunctionVisibility } from "solc-typed-ast";
import {
  ArrayType,
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
    const members = paramTypesToMembers(
      param.components,
      fragment.components as JsonFragmentType[]
    );
    let type: TupleType | StructType;
    if (fragment.internalType) {
      const name = fragment.internalType.replace("struct ", "");
      type = new StructType(members, name);
    } else {
      type = new TupleType(members);
    }
    type.labelFromParent = param.name;
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
    return array;
  } else {
    const elementary = elementaryTypeStringToTypeNode(param.baseType);
    elementary.labelFromParent = param.name;
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
    const members = paramTypesToMembers(fn.inputs, jsonFragment.inputs as JsonFragmentType[]);
    parameters = new TupleType(members);
  }
  if (fn.outputs?.length) {
    const members = paramTypesToMembers(fn.outputs, jsonFragment.outputs as JsonFragmentType[]);
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

  return new EventType(fn.name, parameters);
}

class InterfaceTypes {
  interface: Interface;
  functions: FunctionType[] = [];
  structs: StructType[] = [];
  events: EventType[] = [];
  errors: ErrorType[] = [];

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
    }
    if (node) {
      node.context = this.context;
    }
  }

  getJsonFragment(name: string) {
    const fragment = this.jsonFragments.find((frag) => frag.name === name);
    if (fragment === undefined) {
      throw Error(`JSON fragment not found for ${name}`);
    }
    return fragment;
  }
}

export function readTypeNodesFromABI(jsonFragments: JsonFragment[]): TypeNodeReaderResult {
  const context = new ASTContext();
  const parser = new InterfaceTypes(jsonFragments, context);
  for (const fn of parser.interfaceFunctions) {
    const jsonFragment = parser.getJsonFragment(fn.name);
    parser.addTypeNode(functionFragmentToTypeNode(fn, jsonFragment));
  }
  for (const error of parser.interfaceErrors) {
    const jsonFragment = parser.getJsonFragment(error.name);
    parser.addTypeNode(errorFragmentToTypeNode(error, jsonFragment));
  }
  for (const event of parser.interfaceEvents) {
    const jsonFragment = parser.getJsonFragment(event.name);
    parser.addTypeNode(eventFragmentToTypeNode(event, jsonFragment));
  }

  return {
    context,
    functions: parser.functions,
    structs: parser.structs,
    events: parser.events,
    errors: parser.errors,
    enums: []
  };
}
