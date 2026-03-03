export { addExternalWrappers, upgradeSourceCoders } from "./coders/generate";

/**
 * Options for the text-based code generation approach.
 *
 * @property functionSwitch - Whether to generate a function selector switch (fallback dispatcher)
 * @property decoderFileName - Output filename for the decoder source unit
 * @property outPath - Output directory path for generated files
 */
type CoderOptions = {
  functionSwitch: boolean;
  decoderFileName?: string;
  outPath?: string;
};

const defaultOptions: CoderOptions = {
  functionSwitch: true
};
