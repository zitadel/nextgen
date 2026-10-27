import { ZitadelError } from "../../../../errors";

/**
 * Returns the parenthesised text starting at `openParenIndex` (which must point
 * at a `(`), respecting nested parens/braces/brackets, string literals and line/block comments, plus
 * the index just past the closing `)`.
 */
export function readBalanced(
  source: string,
  openParenIndex: number,
): { text: string; end: number } {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openParenIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i);
      if (newline === -1) break;
      i = newline;
    } else if (ch === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      if (close === -1) break;
      i = close + 1;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "(" || ch === "{" || ch === "[") {
      depth += 1;
    } else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) {
        return { text: source.slice(openParenIndex, i + 1), end: i + 1 };
      }
    }
  }
  throw new ZitadelError("E_VALIDATION", "Malformed Vite config: unbalanced plugin call");
}
