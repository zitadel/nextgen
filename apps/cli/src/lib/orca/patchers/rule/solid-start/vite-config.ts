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
      throw new ZitadelError(
        "E_VALIDATION",
        "Cannot edit the SolidStart Vite config: file not found",
        {
          hint: "Run setup from a SolidStart project that has a vite.config.ts.",
        },
      );
    }

    const callIndex = source.indexOf("solidStart(");
    if (callIndex === -1) {
      throw new ZitadelError(
        "E_VALIDATION",
        "Cannot wire middleware: no solidStart() plugin call found in the Vite config",
        {
          hint: "Ensure vite.config.ts registers the solidStart() plugin from @solidjs/start/config.",
        },
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
    const replacement = ((): string => {
      if (inner === "") {
        // solidStart()  ->  solidStart({ middleware: "./src/middleware.ts" })
        return `solidStart({ ${option} })`;
      }
      if (inner.startsWith("{")) {
        // solidStart({ ...existing })  ->  inject the option after the opening
        // brace. `args.text` is the whole argument list INCLUDING the parens
        // (e.g. "({ ssr: true })"), so reuse it verbatim prefixed by `solidStart`
        // — building from `solidStart(` + args.text would double the opening paren
        // and produce an invalid config.
        const braceIdx = args.text.indexOf("{");
        return `solidStart${args.text.slice(0, braceIdx + 1)} ${option},${args.text.slice(braceIdx + 1)}`;
      }
      // Unusual: a non-object argument (e.g. a variable). Don't guess — fail loud.
      throw new ZitadelError(
        "E_VALIDATION",
        "Cannot wire middleware: solidStart() is called with a non-object argument",
        {
          hint: 'Pass an options object to solidStart(), e.g. solidStart({ middleware: "./src/middleware.ts" }).',
        },
      );
    })();

    return source.slice(0, callIndex) + replacement + source.slice(args.end);
  };
}

/**
 * Returns the parenthesised text starting at `openParenIndex` (which must point
 * at a `(`), respecting nested parens/braces/brackets, string literals and line/block comments, plus
 * the index just past the closing `)`.
 */
function readBalanced(source: string, openParenIndex: number): { text: string; end: number } {
  interface Scan {
    readonly depth: number;
    readonly quote: string | null;
    readonly skipTo: number;
    readonly end: number | undefined;
    readonly unterminated: boolean;
  }
  const next = (state: Scan, patch: Partial<Scan>): Scan => Object.assign({}, state, patch);
  const indexes = Array.from(
    { length: source.length - openParenIndex },
    (_unused, offset) => openParenIndex + offset,
  );
  const scan = indexes.reduce<Scan>(
    (state, i) => {
      if (state.end !== undefined || state.unterminated || i < state.skipTo) {
        return state;
      }
      const ch = source[i];
      if (state.quote) {
        if (ch === "\\") {
          return next(state, { skipTo: i + 2 });
        }
        return ch === state.quote ? next(state, { quote: null }) : state;
      }
      if (ch === "/" && source[i + 1] === "/") {
        const newline = source.indexOf("\n", i);
        return newline === -1
          ? next(state, { unterminated: true })
          : next(state, { skipTo: newline + 1 });
      }
      if (ch === "/" && source[i + 1] === "*") {
        const close = source.indexOf("*/", i + 2);
        return close === -1
          ? next(state, { unterminated: true })
          : next(state, { skipTo: close + 2 });
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        return next(state, { quote: ch });
      }
      if (ch === "(" || ch === "{" || ch === "[") {
        return next(state, { depth: state.depth + 1 });
      }
      if (ch === ")" || ch === "}" || ch === "]") {
        const depth = state.depth - 1;
        return depth === 0 ? next(state, { depth, end: i + 1 }) : next(state, { depth });
      }
      return state;
    },
    { depth: 0, quote: null, skipTo: 0, end: undefined, unterminated: false },
  );
  if (scan.end !== undefined) {
    return { text: source.slice(openParenIndex, scan.end), end: scan.end };
  }
  throw new ZitadelError("E_VALIDATION", "Malformed Vite config: unbalanced solidStart() call");
}
