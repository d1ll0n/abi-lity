import {
  ASTNode,
  ASTWriter,
  Assignment,
  DataLocation,
  DefaultASTWriterMapping,
  Expression,
  FunctionCall,
  FunctionDefinition,
  Identifier,
  InferType,
  LatestCompilerVersion,
  PointerType,
  PrettyFormatter,
  Return,
  SourceUnit,
  TupleExpression,
  TupleType,
  TypeName,
  TypeNode,
  VariableDeclaration,
  VariableDeclarationStatement,
  YulIdentifier,
  assert,
  isReferenceType
} from "solc-typed-ast";
import {
  functionDefinitionToTypeNode,
  solcTypeNodeToTypeNode,
  typeNameToTypeNode
} from "../readers";
import chalk from "chalk";
import { CompileHelper } from "../utils/compile_utils/compile_helper";
import { ArrayType, BytesType, TypeNodeWithChildren, UABIType } from "../ast";
import { SourceEditor } from "../utils/source_editor";

/**
 * Filters an array of FunctionDefinition nodes to only those with
 * at least one reference type return parameter.
 */
export function getFunctionsWithMemoryReturnParameters(
  functions: FunctionDefinition[]
): FunctionDefinition[] {
  return functions.filter(
    (fn) => fn.vReturnParameters.vParameters.some((p) => p.storageLocation === DataLocation.Memory)
    // const type = functionDefinitionToTypeNode(fn);
    // return type.parameters?.vMembers.some((m) => m.isReferenceType);
  );
}

function mapTupleComponents(left: TupleExpression, right: TupleExpression) {
  const leftComponents = left.vOriginalComponents;
  const rightComponents = right.vOriginalComponents;
  assert(leftComponents.length === rightComponents.length, "Tuple lengths must match");
  const assignments: DestructuredAssignment[] = [];
  for (let i = 0; i < leftComponents.length; i++) {
    const leftComp = leftComponents[i];
    const rightComp = rightComponents[i];
    if (leftComp && rightComp) {
      assignments.push(...destructureAssignment(leftComp, rightComp));
    }
  }
  return assignments;
}

function destructureAssignment(left: Expression, right: Expression): DestructuredAssignment[] {
  if (left instanceof TupleExpression && right instanceof TupleExpression) {
    return mapTupleComponents(left, right);
  }
  if (right instanceof Assignment) {
    return destructureAssignment(left, right.vRightHandSide);
  }
  return [{ left, right }];
}

/* function findAssignmentsToFunctionCall(
  assignments: DestructuredAssignment[]
): DestructuredAssignment[] {
  return assignments.filter((a) => {
    const right = a.right;
    if (right instanceof FunctionCall) {
      return right.vReferencedDeclaration === fn.id;
    }
    if (right instanceof TupleExpression) {
      const fnCalls = right.getChildrenByType(FunctionCall);
      return fnCalls.some((fnCall) => fnCall.vReferencedDeclaration === fn.id);
    }
    return false;
  });
} */

type DestructuredAssignment = {
  left: Expression;
  right: Expression;
};

// const isAssignedToFunction

// In any function that returns a reference type, look for assignments to a function call
// If the assignment is to a tuple expression, look for function calls in the corresponding position

const Infer = new InferType(LatestCompilerVersion);

/*
Reference type declarations without initial values waste memory.
Assignments to existing reference type variables waste memory.
*/

const usesMemory = (node: Expression | TypeNode): boolean => {
  if (node instanceof Expression) {
    if (node instanceof TupleExpression) {
      return node.vOriginalComponents.some((c) => c !== null && usesMemory(c));
    }
    return usesMemory(Infer.typeOf(node));
  }
  if (node instanceof TupleType) {
    return node.elements.some(usesMemory);
  }
  return node instanceof PointerType && node.location === DataLocation.Memory;
};

const declarationUsesMemory = (decl: VariableDeclaration): boolean => {
  const type = typeNameToTypeNode(decl.vType as TypeName);

  if (type.isReferenceType && decl.storageLocation === DataLocation.Memory) {
    if (type instanceof BytesType || (type instanceof ArrayType && type.length === undefined)) {
      return false;
    }
    return true;
  }
  return false;
};

function getIdentifiersInScope(scope: ASTNode, target: VariableDeclaration) {
  scope.getChildrenByType(Identifier).filter((id) => id.referencedDeclaration === target.id);

  scope.getChildrenByType(YulIdentifier).filter((id) => id.referencedDeclaration === target.id);
}

function isAssignmentToReferenceType(assignment: DestructuredAssignment) {
  const left = assignment.left;
  const right = assignment.right;
  const r = Infer.typeOf(right);
  return usesMemory(left) && usesMemory(right);
  // if (right instanceof FunctionCall) {
  // return usesMemory(left) && usesMemory(right);
  /* if (left instanceof Identifier) {
      return isReferenceType(Infer.typeOfIdentifier(left));
    }
     */
  /* if (left instanceof TupleExpression) {
      return left.vOriginalComponents.some(c => {
        if (!c) return false;
        return usesMemory(c);
      });
    } */
  // }
  // if (left instanceof Identifier) {

  //  isReferenceType(Infer.typeOfIdentifier(left)) && right instanceof FunctionCall;
  // }
  // if (left instanceof TupleExpression) {
  // if (left.vOriginalComponents.some(c => {
  //
  // }))
  // }
  // Infer.typeOfAssignment
}

/* function newReferenceAssignments(assignment: Assignment) {
  const subAssignments = destructureAssignment(assignment.vLeftHandSide, assignment.vRightHandSide);
  subAssignments.filter(({ left, right }) => {
    if (left instanceof Identifier && right instanceof FunctionCall) {
      return true;
    }
    if (left instanceof TupleExpression && !(right instanceof FunctionCall)) {
      throw Error(`Tuple assignment to non-function call should have been destructured`)
    }
  })
  if (assignment.vLeftHandSide instanceof TupleExpression) {
    const left = assignment.vLeftHandSide;
    const right = assignment.vRightHandSide;

    if (right instanceof TupleExpression) {
      
    }
  }
} */

/*
Look for reference type return parameters that are:
- declared without a name
- assigned to a function call
- assigned in a tuple expression where the right side is a function call
- assigned in a tuple expression where the right side is a tuple expression with a function call in the corresponding position
*/

function getAssignmentsToReferenceType(fn: FunctionDefinition) {
  const assignments = fn
    .getChildrenByType(Assignment)
    .reduce(
      (arr, assignment) => [
        ...arr,
        ...destructureAssignment(assignment.vLeftHandSide, assignment.vRightHandSide)
      ],
      [] as DestructuredAssignment[]
    );
  return assignments.filter(isAssignmentToReferenceType);
}

function getInitialValue(decl: VariableDeclaration): Expression | undefined {
  const parent = decl.parent;
  if (parent instanceof VariableDeclarationStatement) {
    const init = parent.vInitialValue;
    if (init instanceof TupleExpression) {
      const tupleIdx = parent.vDeclarations.indexOf(decl);
      return init.vOriginalComponents[tupleIdx] || undefined;
    }
    return init;
  }
  return decl.vValue;
}

function findUnassignedMemoryDeclarations(fn: FunctionDefinition) {
  if (!fn.vBody) return [];
  const declarations = fn.vBody.getChildrenByType(VariableDeclaration);
  return declarations.filter((decl) => {
    return decl.storageLocation === DataLocation.Memory && getInitialValue(decl) === undefined;
  });
}

function highlightNode(file: string, node: ASTNode) {
  const { length, offset } = node.sourceInfo;
  return (
    file.slice(0, offset) +
    chalk.underline(chalk.red(file.slice(offset, offset + length))) +
    file.slice(offset + length)
  );
}

function lookForMemoryWaste(source: SourceUnit, editor: SourceEditor) {
  const functions = source.getChildrenByType(FunctionDefinition);
  const writer = new ASTWriter(
    DefaultASTWriterMapping,
    new PrettyFormatter(2),
    LatestCompilerVersion
  );
  // const editor = new SourceEditor(file, writer);

  for (const func of functions) {
    const assignments = getAssignmentsToReferenceType(func);
    for (const decl of func.vReturnParameters.vParameters) {
      if (!decl.name && decl.storageLocation === DataLocation.Memory) {
        const type = typeNameToTypeNode(decl.vType as TypeName);
        if (
          type.isReferenceType &&
          !(type instanceof BytesType || (type instanceof ArrayType && type.length === undefined))
        ) {
          const declText = writer.write(decl);
          const parentText = writer
            .write(func)
            .replace(declText, chalk.underline(chalk.red(declText)));
          const size = type.extendedMemoryAllocationSize;
          editor.highlightNode(decl, chalk.red);
          const comment = ` unnamed ${type.identifier} return parameter allocates and zeroes ${
            size ? `${size} bytes of ` : ""
          }memory`;
          editor.insertBefore(decl, `/* ${comment} */`);

          // type instanceof TypeNodeWithChildren
          //   ? type.embeddedMemoryHeadSize + (type.extendedMemoryDataSize ?? type.memoryTailSize)
          //   : type.extendedMemoryDataSize;
          // if (size === undefined) {
          //   const getSize = (type: UABIType) => {
          //     return type.memoryDataSize

          //   }
          // }
        }
      }
    }
    console.log(editor.text);

    for (const assignment of assignments) {
      const parent = assignment.left.getClosestParentByType(Assignment) as Assignment;

      const lhs = writer.write(assignment.left); //chalk.underline();
      const rhs = writer.write(assignment.right); //chalk.underline
      const text = writer
        .write(parent)
        .replace(lhs, chalk.underline(chalk.red(lhs)))
        .replace(rhs, chalk.underline(chalk.red(rhs)));
      console.log(`In ${func.name}: assignment to existing memory value\n\t${text}`);
    }

    const declarations = findUnassignedMemoryDeclarations(func);
    for (const decl of declarations) {
      const text = writer.write(decl);
      console.log(`In ${func.name}: declaration without initial value\n\t${text}`);
    }
  }
  const declarations = functions
    .map(findUnassignedMemoryDeclarations)
    .reduce((arr, decls) => [...arr, ...decls], []);
  return declarations;
}

async function testLookup() {
  const code = `
  contract Test {
    struct ABC { uint256 a; uint256 b; bytes d; uint256[] arr; bytes[1] arr2; }

    struct Info {
      uint256 a;
    }
    
    function abc() internal returns (Info memory) {
      Info memory x;
      x.a = 100;
      return x;
    }

    function getABC() internal view returns (ABC memory) {
      return ABC({ a: 1, b: 2, d: "", arr: new uint256[](0), arr2: [bytes("")] });
    }
  }
  `;
  const helper = await CompileHelper.fromFiles(new Map([["test.sol", code]]));
  const sourceMap = new Map();
  const files = helper.getFiles(sourceMap);
  const editor = new SourceEditor(files.get("test.sol")!, sourceMap);
  const source = helper.sourceUnits[0];
  lookForMemoryWaste(source, editor);
}
testLookup();
// function getFunctionsWithReferenceTypeReturnParameters

// function getReturnKinds(fn: FunctionDefinition) {
//   const body = fn.vBody;
//   if (!body) return;
//   const fnType = functionDefinitionToTypeNode(fn);

//   const returnStatements = body.getChildrenByType(Return);
//   const assignments = body.getChildrenByType(Assignment);
//   const referenceTypeParameters = fnType.parameters?.vMembers.filter((m, i) => {
//     if (!m.isReferenceType) return false;
//     const param = fn.vReturnParameters.vParameters[i];
//     const explicit = Boolean(param.name);
//     const references = body
//       .getChildrenByType(Identifier)
//       .filter((id) => id.referencedDeclaration === param.id);
//     const assigns = references
//       .map((ref) => {
//         const assign = ref.getClosestParentByType(Assignment);
//         // If ref is the left side of the assign, or is a child of it
//         if (
//           assign && (
//             assign.vLeftHandSide === ref ||
//           assign?.vLeftHandSide.getChildrenBySelector((n) => n === ref).length > 0)
//           ) return assign;
//       })
//       .filter((a) => a !== undefined) as Assignment[];
//     const assignsToNewData = assigns.filter((a) => {
//       const right = a.vRightHandSide;
//       if (
//         right instanceof FunctionCall ||
//         right instanceof TupleExpression
//         ) {
//         return true;
//       }

//     }
//     return {
//       explicit,
//       param
//     };
//   });
//   const explicitDeclarations = fn.vReturnParameters.vParameters;
// }
