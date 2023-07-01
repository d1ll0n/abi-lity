/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  ASTSearch,
  ContractDefinition,
  ContractKind,
  EventDefinition,
  ExternalReferenceType,
  FunctionDefinition,
  SourceUnit,
  StringOrNumberAttributes,
  assert
} from "solc-typed-ast";
import { ASTNodeKind, ASTNodeMap } from "solc-typed-ast/dist/ast/implementation";
import {
  buildDecoderFile,
  buildExternalWrapper,
  replaceExternalFunctionReferenceTypeParameters
} from "./abi_decode";
import {
  Logger,
  NoopLogger,
  getHashWithAbiEncodeParameterTypes,
  isExternalFunction,
  isAbiEncodeCall,
  getAbiEncodeParameterTypes
} from "../../utils";
import { getFunctionSelectorSwitch, upgradeFunctionCoders } from "./function_switch";
import { CompileHelper } from "../../utils/compile_utils/compile_helper";
import { renamePublicStateVariables } from "./state_variables";
import { eventDefinitionToTypeNode, functionDefinitionToTypeNode } from "../../readers";
import {
  createAbiEncodingFunctionWithAllocation,
  createEmitFunction,
  createHashFunction,
  createReturnFunction
} from "./abi_encode";
import { TypeNode } from "../../ast";

export type Options = {
  outputPath?: string;
  replaceReturnStatements?: boolean;
  replaceHashCalls?: boolean;
  replaceEmitCalls?: boolean;
  replaceAbiEncodeCalls?: boolean;
  replaceStateVariables?: boolean;
  outputToLibrary?: boolean;
  decoderFileName?: string;
  functionSwitch?: boolean;
};
type WithInvertedProperties<Obj> = Obj & {
  any?: Obj | Obj[];
  not?: Obj | Obj[];
  notAny?: Obj | Obj[];
};
type SolChildSearchType = {
  [K in ASTNodeKind]: {
    tag: K;
  } & SolSearchAttributes<K>;
};
type SolSearchAttributes<T extends ASTNodeKind> = WithInvertedProperties<
  Partial<StringOrNumberAttributes<ASTNodeMap[T]>> & {
    children?: Array<SolChildSearchType[keyof SolChildSearchType]>;
    ancestors?: Array<SolChildSearchType[keyof SolChildSearchType]>;
  }
>;

/// @todo Identify pipelines where data is immediately going from one
/// coder to another, e.g.:
/// x = abi.decode; abi.encode(x)
/// return abi.encode()
/// heuristic:
/// - expression only used as function argument
/// - expression only used as return statement
/// - expression used in assignment to identifier with single reference

function mapAllNodes<T extends ASTNodeKind, N extends TypeNode>(
  search: ASTSearch,
  kind: T,
  getType: (node: ASTNodeMap[T]) => [string, N] | undefined,
  attributes?: SolSearchAttributes<T> | undefined
): Array<[N, Array<ASTNodeMap[T]>]> {
  const nodes = search.find(kind, attributes);
  const typeMap = new Map<string, { type: N; nodes: Array<ASTNodeMap[T]> }>();
  for (const node of nodes) {
    const result = getType(node);
    if (!result) continue;
    const [id, type] = result;
    if (!typeMap.has(id)) {
      typeMap.set(id, { type, nodes: [] });
    }
    typeMap.get(id)!.nodes.push(node);
  }
  return [...typeMap.values()].map(({ type, nodes }) => [type, nodes]);
}

function getMostDerivedContracts(sourceUnit: SourceUnit): ContractDefinition[] {
  const _contractDefinitions = sourceUnit
    .getChildrenByType(ContractDefinition)
    .filter((c) => c.kind === ContractKind.Contract);

  _contractDefinitions.sort(
    (a, b) => b.linearizedBaseContracts.length - a.linearizedBaseContracts.length
  );

  const contractDefinitions: ContractDefinition[] = [];
  for (const contractDefinition of _contractDefinitions) {
    if (
      contractDefinitions.some((c) =>
        c.linearizedBaseContracts.slice(1).includes(contractDefinition.id)
      )
    ) {
      continue;
    } else {
      contractDefinitions.push(contractDefinition);
    }
  }
  return contractDefinitions;
}

export function upgradeSourceCoders(
  helper: CompileHelper,
  fileName: string,
  options: Options,
  logger: Logger = new NoopLogger()
): void {
  if (options.functionSwitch) {
    options.replaceReturnStatements = true;
  }
  const decoderFileName = options.decoderFileName ?? fileName.replace(".sol", "Decoder.sol");
  let decoderSourceUnit: SourceUnit;

  const sourceUnit = helper.getSourceUnit(fileName);
  const contractDefinitions = getMostDerivedContracts(sourceUnit);
  // console.log(`Replacing state vars in ${contractDefinitions.length} contracts...`);

  for (const contractDefinition of contractDefinitions) {
    if (options.replaceStateVariables) {
      logger.log(`replacing state variables in ${contractDefinition.name}...`);
      const search = ASTSearch.fromContract(contractDefinition, false);
      renamePublicStateVariables(search);
    }
  }

  if (helper.hasSourceUnit(decoderFileName)) {
    console.log(`ALREADY HAVE SOURCE CODER`);
    decoderSourceUnit = helper.getSourceUnit(decoderFileName);
  } else {
    logger.log(`generating decoders for ${fileName}...`);
    const ctx = buildDecoderFile(helper, fileName, decoderFileName, options);
    decoderSourceUnit = ctx.sourceUnit;
    const functions = sourceUnit.getChildrenBySelector(isExternalFunction) as FunctionDefinition[];

    const functionTypes = functions.map(functionDefinitionToTypeNode);

    if (options.replaceReturnStatements) {
      for (const fn of functionTypes) {
        const params = fn.returnParameters;
        if (!params || !params.vMembers.length) continue;
        createReturnFunction(ctx, params);
      }
    }
    const search = ASTSearch.from(helper.sourceUnits);

    if (options.replaceEmitCalls) {
      const eventsWithEmitStatements = mapAllNodes(search, "EmitStatement", (stmt) => {
        const call = stmt.vEventCall;
        const definition = call.vReferencedDeclaration;
        assert(
          definition instanceof EventDefinition,
          `Error in EmitStatement: Expected call to EventDefinition, got ${definition?.type}`
        );
        const type = eventDefinitionToTypeNode(definition);
        return [type.writeDefinition(), type];
      });
      for (const [type, statements] of eventsWithEmitStatements) {
        createEmitFunction(ctx, type, statements);
      }
    }

    const hashCalls = new Set();
    if (options.replaceHashCalls) {
      const hashTypesWithCalls = mapAllNodes(
        search,
        "FunctionCall",
        (call) => {
          if (!(call.vArguments.length === 1 && isAbiEncodeCall(call.vArguments[0]))) {
            return undefined;
          }
          const type = getHashWithAbiEncodeParameterTypes(call);
          const id = type.identifier;
          return [id, type];
        },
        {
          vFunctionCallType: ExternalReferenceType.Builtin,
          vFunctionName: "keccak256"
        }
      );
      for (const [type, calls] of hashTypesWithCalls) {
        for (const call of calls) {
          hashCalls.add(call.vArguments[0]);
        }
        createHashFunction(ctx, type, calls);
      }
    }

    /// This must be done after createHashFunction because the hash
    /// function searches for keccak256 calls which use abi.encode
    if (options.replaceAbiEncodeCalls) {
      const abiEncodeCalls = mapAllNodes(
        search,
        "FunctionCall",
        (call) => {
          if (hashCalls.has(call)) return undefined;
          const type = getAbiEncodeParameterTypes(call);
          const id = type.identifier;
          return [id, type];
        },
        {
          vFunctionCallType: ExternalReferenceType.Builtin,
          vFunctionName: "encode",
          vIdentifier: "abi"
        }
      );
      for (const [type, calls] of abiEncodeCalls) {
        createAbiEncodingFunctionWithAllocation(ctx, type, calls);
      }
    }

    ctx.applyPendingFunctions();
  }

  logger.log(`replacing parameter declarations in ${fileName}...`);
  replaceExternalFunctionReferenceTypeParameters(sourceUnit, decoderSourceUnit);

  for (const contractDefinition of contractDefinitions) {
    if (contractDefinition.kind !== ContractKind.Contract) continue;
    if (options.functionSwitch) {
      logger.log(`generating function dispatch for ${contractDefinition.name}...`);
      getFunctionSelectorSwitch(
        contractDefinition,
        decoderSourceUnit,
        options.replaceReturnStatements
      );
      console.log(`generated dispatch for ${contractDefinition.name}...`);
    } else {
      upgradeFunctionCoders(contractDefinition, decoderSourceUnit, options.replaceReturnStatements);
    }
  }
}

export function addExternalWrappers(
  helper: CompileHelper,
  fileName: string,
  logger: Logger = new NoopLogger()
): void {
  const decoderFileName = fileName.replace(".sol", "External.sol");

  logger.log(`generating wrappers for ${fileName}...`);
  buildExternalWrapper(helper, fileName, decoderFileName);
}
