// import { ArrayType, ASTContext, TypeNode } from "../ast";

// function parseTypeString(context: ASTContext, typeString: string) {
//   typeString = typeString.trim();

//   const [, baseTypeString, isArray, arraySize] = /(.+)(\[(\d*)\])$/.exec(typeString) ?? [];
//   if (isArray) {
//     return new ArrayType(
//       parseTypeString(context, baseTypeString),
//       arraySize ? +arraySize : undefined
//     );
//   }
//   const definedType = context.getNodesBySelector((node: TypeNode) => node.canonicalName);
// }
// "(a, b, c)".match(/\((([^,]+,)*[^,)]+)\)/);
