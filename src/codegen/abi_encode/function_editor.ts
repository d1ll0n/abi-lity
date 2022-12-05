import {
  Assignment,
  ASTNodeFactory,
  Expression,
  ExpressionStatement,
  FunctionCallKind,
  FunctionDefinition,
  Identifier,
  replaceNode,
  Return,
  VariableDeclaration
} from "solc-typed-ast";
import { getParametersTypeString, last } from "../../utils";

export function replaceReturnStatementsWithCall(
  fn: FunctionDefinition,
  returnFn: FunctionDefinition
): void {
  const { vBody, vReturnParameters } = fn;
  if (!vReturnParameters.children.length || !vBody) return;

  const factory = new ASTNodeFactory(fn.requiredContext);

  const returnStatements = fn.getChildrenByType(Return, true);
  const returnTypeString = getParametersTypeString(vReturnParameters.vParameters);
  const returnFnIdentifier = factory.makeIdentifierFor(returnFn);

  const statements = vBody?.vStatements ?? [];
  const lastStatement = last(statements);
  const lastStatementIsReturn = returnStatements.some(
    (st) => st === lastStatement || st.getParentsBySelector((p) => p === lastStatement).length > 0
  );

  const makeReturnCallStatement = (args: Expression[]) =>
    factory.makeExpressionStatement(
      factory.makeFunctionCall(
        returnTypeString,
        FunctionCallKind.FunctionCall,
        returnFnIdentifier,
        args
      )
    );

  for (const returnStatement of returnStatements) {
    replaceNode(returnStatement, makeReturnCallStatement(returnStatement.children as Expression[]));
  }
  // @todo Handle cases where some parameters are not named
  const parameterDeclarations: VariableDeclaration[] = [];

  while (vReturnParameters.children.length > 0) {
    const parameter = vReturnParameters.children[0] as VariableDeclaration;
    // Define return params at start of body
    if (parameter.name) {
      const references = fn
        .getChildrenByType(Identifier)
        .filter((node) => node.name === parameter.name);
      if (references.length) {
        const copy = factory.copy(parameter);
        parameterDeclarations.push(copy);
        const statement = factory.makeVariableDeclarationStatement([copy.id], [copy]);
        // If first reference to return parameter is inside an assignment,
        // replace the assignment with a variable declaration statement
        const assignment = references[0].getClosestParentByType(Assignment);
        if (
          assignment?.parent instanceof ExpressionStatement &&
          assignment?.parent.parent === vBody
        ) {
          statement.vInitialValue = assignment.vRightHandSide;
          replaceNode(assignment.parent, statement);
        } else {
          vBody.insertAtBeginning(statement);
        }
      }
    }
    // Remove return parameter
    vReturnParameters.removeChild(parameter);
  }
  if (!lastStatementIsReturn) {
    const args = parameterDeclarations.map((p) => factory.makeIdentifierFor(p));
    vBody.appendChild(makeReturnCallStatement(args));
  }
}
