import path from "path";
import { Argv } from "yargs";
import {
  DebugLogger,
  mkdirIfNotExists,
  writeFilesTo,
  writeNestedStructure
} from "../../../../utils";
import { getCommandLineInputPaths } from "../../../utils";
import { generateForgeJsonSerializers } from "./generate";

const options = {
  input: {
    alias: ["i"],
    describe: "Input Solidity file.",
    demandOption: true,
    coerce: path.resolve
  },
  output: {
    alias: ["o"],
    describe: "Output directory, defaults to directory of input.",
    demandOption: true,
    coerce: path.resolve
  },
  struct: {
    alias: ["s"],
    describe: "Struct to generate serializers for",
    type: "array"
  }
} as const;

export const addCommand = <T>(yargs: Argv<T>): Argv<T> =>
  yargs.command(
    "forge-json <input> [output]",
    writeNestedStructure(["Generate JSON serializers for forge"]),
    options,
    async (args) => {
      const { basePath, output, fileName, helper } = await getCommandLineInputPaths(
        args,
        false,
        false,
        {
          optimizer: false,
          runs: 0,
          viaIR: false
        }
      );
      const logger = new DebugLogger();
      mkdirIfNotExists(output);
      const primaryFilePath = path.join(
        output,
        path.basename(fileName.replace(".sol", "Serializers.sol"))
      );
      generateForgeJsonSerializers(
        helper,
        fileName,
        {
          outPath: output,
          decoderFileName: primaryFilePath
        },
        args.struct as string | string[],
        logger
      );
      console.log(`writing serializer...`);
      const files = helper.getFiles();
      const newCode = writeNestedStructure([
        `import { Vm } from "forge-std/Vm.sol";`,
        "",
        `address constant VM_ADDRESS = address(`,
        [`uint160(uint256(keccak256("hevm cheat code")))`],
        `);`,
        `Vm constant vm = Vm(VM_ADDRESS);`
      ]);
      const code = files.get(primaryFilePath) as string;
      files.clear();
      files.set(primaryFilePath, code.replace(`import "./Temp___Vm.sol";`, newCode));
      writeFilesTo(output, files);
      console.log(`done!`);
    }
  );
