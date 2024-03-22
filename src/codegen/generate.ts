export { addExternalWrappers, upgradeSourceCoders } from "./coders/generate";

type CoderOptions = {
  functionSwitch: boolean;
  decoderFileName?: string;
  outPath?: string;
};

const defaultOptions: CoderOptions = {
  functionSwitch: true
};
