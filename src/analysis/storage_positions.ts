import { assert } from "solc-typed-ast";
import { ArrayType, StructType, TypeNode, UValueType, ValueType, isUValueType } from "../ast";
import { coerceArray } from "../utils";

export type StoragePosition = {
  slot: number;
  slotOffsetBytes: number;
  parentOffsetBytes: number;
  bytesLength: number;
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

export class StoragePositionTracker {
  slot = 0;
  slotOffsetBytes = 0;
  positions: StoragePosition[] = [];

  forceNextSlot(): void {
    if (this.slotOffsetBytes !== 0) {
      this.slot++;
      this.slotOffsetBytes = 0;
    }
  }

  visitValueType(field: UValueType): StoragePosition {
    assert(field.labelFromParent !== undefined, "Expected field to have a label");
    const bytesLength = field.exactBytes as number;
    if (this.slotOffsetBytes + bytesLength > 32) {
      this.slot++;
      this.slotOffsetBytes = 0;
    }
    const position = {
      slot: this.slot,
      slotOffsetBytes: this.slotOffsetBytes,
      parentOffsetBytes: this.slot * 32 + this.slotOffsetBytes,
      bytesLength,
      label: field.labelFromParent,
      type: field
    };
    this.slotOffsetBytes += bytesLength;
    return position;
  }

  visitStruct(field: StructType): StoragePosition[] {
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

  visitArray(field: ArrayType): StoragePosition[] {
    assert(field.labelFromParent !== undefined, "Expected field to have a label");
    this.forceNextSlot();
    const child = field.baseType;
    // @todo Implement dynamic array storage cache
    assert(field.length !== undefined, "Expected array to have a length");
    const positions: StoragePosition[] = [];
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

  visit(fields: TypeNode | TypeNode[]): StoragePosition[] {
    fields = coerceArray(fields);
    const positions: StoragePosition[] = [];
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

  static getPositions(struct: StructType | ArrayType): StoragePosition[] {
    const tracker = new StoragePositionTracker();
    return tracker.visit(struct);
  }
}
