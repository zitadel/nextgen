import { ZitadelError } from "../../../../errors";

const MIDDLEWARE_PATH = "./src/middleware.ts";

/**
 * Builds the pure `edit` transform the file-writer applies to a SolidStart
 * project's `vite.config.*`: registers the managed `src/middleware.ts` (which
 * wires the server-side proxy + session middleware) by adding the `middleware`
 * option to the `solidStart()` plugin call.
 *
 * SolidStart 2 reads middleware from the `solidStart({ middleware })` plugin
 * option (`@solidjs/start/config`), not from a top-level `app.config.ts` field
 * as SolidStart 1 did — so the edit targets the plugin call. Because the option
 * lives inside a call-expression argument (which magicast's object helpers do
 * not model), this is a small, idempotent source transform rather than a
 * magicast object edit: it injects into a bare `solidStart()` or merges into an
 * existing `solidStart({ ... })`, and returns the source untouched once the
 * `middleware` option is present. Throws `E_VALIDATION` when no `solidStart(`
 * plugin call is found (an unexpected SolidStart config shape).
 */
export function solidStartConfigEdit(): (source: string | undefined) => string {
  return (source) => {
    if (source === undefined) {
      throw new ZitadelError("E_VALIDATION", "Cannot edit the SolidStart Vite config: file not found", {
        hint: "Run setup from a SolidStart project that has a vite.config.ts.",
      });
    }

    const callIndex = source.indexOf("solidStart(");
    if (callIndex === -1) {
      throw new ZitadelError(
        "E_VALIDATION",
        "Cannot wire middleware: no solidStart() plugin call found in the Vite config",
        { hint: "Ensure vite.config.ts registers the solidStart() plugin from @solidjs/start/config." },
      );
    }

    const openParen = callIndex + "solidStart(".length - 1;
    const args = readBalanced(source, openParen);
    const inner = args.text.slice(1, -1).trim();

    // Already wired (idempotent): the call carries a `middleware` option, or our
    // managed path is present anywhere in the config.
    if (/(^|[{,\s])middleware\s*:/.test(inner) || source.includes(MIDDLEWARE_PATH)) {
      return source;
    }

    const option = `middleware: ${JSON.stringify(MIDDLEWARE_PATH)}`;
    let replacement: string;
    if (inner === "") {
      // solidStart()  ->  solidStart({ middleware: "./src/middleware.ts" })
      replacement = `solidStart({ ${option} })`;
    } else if (inner.startsWith("{")) {
      // solidStart({ ...existing })  ->  inject the option after the opening brace
      const objStart = args.text.indexOf("{") + 1;
      const before = args.text.slice(0, objStart);
      const rest = args.text.slice(objStart);
      replacement = `solidStart(${before} ${option},${rest}`;
    } else {
      // Unusual: a non-object argument (e.g. a variable). Don't guess — fail loud.
      throw new ZitadelError(
        "E_VALIDATION",
        "Cannot wire middleware: solidStart() is called with a non-object argument",
        { hint: "Pass an options object to solidStart(), e.g. solidStart({ middleware: \"./src/middleware.ts\" })." },
      );
    }

    return source.slice(0, callIndex) + replacement + source.slice(args.end);
  };
}

/**
 * Returns the parenthesised text starting at `openParenIndex` (which must point
 * at a `(`), respecting nested parens/braces/brackets and string literals, plus
 * the index just past the closing `)`.
 */
function readBalanced(source: string, openParenIndex: number): { text: string; end: number } {
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
    if (ch === '"' || ch === "'" || ch === "`") {
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
  throw new ZitadelError("E_VALIDATION", "Malformed Vite config: unbalanced solidStart() call");
}
