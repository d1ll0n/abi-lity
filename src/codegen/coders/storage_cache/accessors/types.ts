export type ParameterLocation = {
  dataReference: string;
  leftAligned: boolean;
  offset: number;
  bytesLength: number;
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
