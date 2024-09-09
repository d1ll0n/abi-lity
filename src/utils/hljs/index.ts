import hljs from "highlight.js";
import { highlight } from "cli-highlight";
import yul from "./languages/yul";
import solidity from "./languages/solidity";
import { YulTheme } from "./theme";
hljs.registerLanguage("yul", yul);
hljs.registerLanguage("solidity", solidity);

export function highlightYul(code: string): string {
  return highlight(code, {
    language: "yul",
    theme: YulTheme
  });
}

export function highlightSolidity(code: string): string {
  return highlight(code, {
    language: "solidity",
    theme: YulTheme
  });
}
