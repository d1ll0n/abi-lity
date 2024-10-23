import { assert } from "solc-typed-ast";
import { ArrayType, StructType, TypeNode, UValueType, ValueType, isUValueType } from "../ast";
import { coerceArray } from "../utils";

export type BitPackedStoragePosition = {
  slot: number;
  slotOffsetBits: number;
  parentOffsetBits: number;
  bitsLength: number;
  label: string;
  type: ValueType;
} & (
  | {
      arrayParentId: number;
      arrayIndex: number;
    }
  | {
      arrayParentId?: undefined;
      arrayIndex?: undefined;
    }
);

export class EfficientStoragePositionsTracker {
  slot = 0;
  slotOffsetBits = 0;
  positions: BitPackedStoragePosition[] = [];

  forceNextSlot(): void {
    if (this.slotOffsetBits !== 0) {
      this.slot++;
      this.slotOffsetBits = 0;
    }
  }

  visitValueType(field: UValueType): BitPackedStoragePosition {
    assert(field.labelFromParent !== undefined, "Expected field to have a label");
    const bitsLength = field.exactBits as number;
    if (this.slotOffsetBits + bitsLength > 256) {
      this.slot++;
      this.slotOffsetBits = 0;
    }
    const position = {
      slot: this.slot,
      slotOffsetBits: this.slotOffsetBits,
      parentOffsetBytes: this.slot * 32 + this.slotOffsetBits,
      parentOffsetBits: this.slot * 256 + this.slotOffsetBits,
      bytesLength: Math.ceil(bitsLength / 8),
      bitsLength,
      label: field.labelFromParent,
      type: field
    };
    this.slotOffsetBits += bitsLength;
    return position;
  }

  visitStruct(field: StructType): BitPackedStoragePosition[] {
    // @todo Implement dynamic struct storage cache
    assert(
      field.exactBytes !== undefined,
      `Unsupported operation: generate storage cache object for dynamic struct ${field.writeDefinition()}`
    );
    const labelPrefix = field.labelFromParent ? `${field.labelFromParent}.` : "";
    this.forceNextSlot();
    const positions = this.visit(field.vMembers);
    for (const position of positions) {
      position.label = `${labelPrefix}${position.label}`;
    }
    return positions;
  }

  visitArray(field: ArrayType): BitPackedStoragePosition[] {
    assert(field.labelFromParent !== undefined, "Expected field to have a label");
    this.forceNextSlot();
    const child = field.baseType;
    // @todo Implement dynamic array storage cache
    assert(field.length !== undefined, "Expected array to have a length");
    const positions: BitPackedStoragePosition[] = [];
    for (let i = 0; i < field.length; i++) {
      const element = child.copy();
      element.parent = field;
      element.labelFromParent = `${field.labelFromParent}[${i}]`;
      const childPositions = this.visit(element);
      for (const position of childPositions) {
        position.arrayParentId = field.id;
        position.arrayIndex = i;
      }
      positions.push(...childPositions);
    }
    return positions;
  }

  visit(fields: TypeNode | TypeNode[]): BitPackedStoragePosition[] {
    fields = coerceArray(fields);
    const positions: BitPackedStoragePosition[] = [];
    for (const field of fields) {
      if (field instanceof StructType) {
        positions.push(...this.visitStruct(field));
      } else if (field instanceof ArrayType) {
        positions.push(...this.visitArray(field));
      } else if (isUValueType(field)) {
        positions.push(this.visitValueType(field));
      }
    }
    return positions;
  }

  static getPositions(struct: StructType | ArrayType): BitPackedStoragePosition[] {
    const tracker = new EfficientStoragePositionsTracker();
    return tracker.visit(struct);
  }
}
