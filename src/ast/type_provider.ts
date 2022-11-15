import { IntegerType } from "./value/integer_type";

export class TypeProvider {
  static uint(bits: number): IntegerType {
    return new IntegerType(bits, false);
  }
}
