// @todo Shouldn't need to define both bytes and bits lengths/offsets
// just a temporary solution to keep existing code working until it
// fully supports values that aren't a round number of bytes
export type ParameterLocation = {
  /// Reference to parent object
  dataReference: string;
  /// Whether the value is left aligned (e.g. bytes<n>)
  /// Note: refers to the value itself, not its position in the parent
  leftAligned: boolean;
  /// Offset in bytes from the start of the parent object to the
  /// start of the parameter
  bytesOffset: number;
  /// Offset in bits from the start of the parent object to the
  /// start of the parameter
  bitsOffset: number;
  /// Length in bytes of the parameter
  bytesLength: number;
  /// Length in bits of the parameter
  bitsLength: number;
};

export type WriteParameterArgs = ParameterLocation & {
  value: string | number;
  gasToCodePreferenceRatio?: number;
  defaultSelectionForSameScore?: "leastgas" | "leastcode";
};

export type ReadParameterArgs = ParameterLocation & {
  /** @param gasToCodePreferenceRatio the amount of gas that must be saved to add 1 byte of code. */
  gasToCodePreferenceRatio?: number;
  defaultSelectionForSameScore?: "leastgas" | "leastcode";
};
