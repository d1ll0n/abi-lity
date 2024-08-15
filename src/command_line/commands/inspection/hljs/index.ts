import hljs from "highlight.js";
import { highlight } from "cli-highlight";
import yul from "./languages/yul";
import { YulTheme } from "./theme";
hljs.registerLanguage("yul", yul);

export function highlightYul(code: string): string {
  return highlight(code, {
    language: "yul",
    theme: YulTheme
  });
}
