import { IntegerType } from "./value/integer_type";

/**
 * Factory class providing shorthand methods for creating common TypeNode instances.
 */
export class TypeProvider {
  /** Creates an unsigned integer type with the given bit width. */
  static uint(bits: number): IntegerType {
    return new IntegerType(bits, false);
  }
}
