import {
  createZitadelClient as createRawClient,
  type ZitadelClient,
  type ZitadelClientOptions,
} from "@zitadel/api/client";
import { ApiError } from "@zitadel/api/runtime/fetch";

/**
 * Characters that can drive a terminal rather than print on it: the C0
 * controls (ESC among them), DEL and the C1 controls (`\p{Cc}`), the format
 * and bidi controls (`\p{Cf}`), and the line and paragraph separators. Newline
 * and tab are left alone unless the caller asks otherwise, because they are
 * how a description or a multi-line value is written.
 */
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** Options for {@link escapeControlCharacters}. */
export type EscapeOptions = {
  /**
   * Keep `\n` and `\t` as they are. On by default; a renderer that must keep
   * a value on one line turns it off.
   */
  keepLayout?: boolean;
};

/**
 * Escape every character that could drive the reader's terminal to its
 * visible `\xNN`/`\uNNNN` spelling, or `\u{NNNNN}` above the BMP so the
 * spelling cannot run into the character that follows it.
 *
 * Anything the server returns was written by someone — a user's name, a
 * branding value, a variable — and an ESC or OSC sequence in it would
 * otherwise clear the screen, set the window title, write the clipboard
 * through OSC 52, or disguise a link through OSC 8 when printed. Ordinary text
 * is unchanged, so readable values stay readable.
 */
export function escapeControlCharacters(text: string, opts: EscapeOptions = {}): string {
  const keepLayout = opts.keepLayout ?? true;
  return text.replace(CONTROL, (char) => {
    if (keepLayout && (char === "\n" || char === "\t")) {
      return char;
    }
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0xff) {
      return `\\x${code.toString(16).padStart(2, "0")}`;
    }
    return code <= 0xffff
      ? `\\u${code.toString(16).padStart(4, "0")}`
      : `\\u{${code.toString(16)}}`;
  });
}

/**
 * Escape an object key. Unlike a value, a key must stay distinct from its
 * siblings: a key holding a raw ESC and one holding the literal text `\x1b`
 * would otherwise both come out as `\x1b`, and one of the two fields would be
 * lost. Doubling the backslash first makes the spelling unambiguous.
 */
function escapeKey(key: string): string {
  return escapeControlCharacters(key.replaceAll("\\", "\\\\"));
}

/** An array or object still to be copied, paired with the copy to fill. */
type Pending = { source: object; target: Record<string, unknown> | unknown[] };

/**
 * Escape every string in a decoded JSON value, keys included, at any depth.
 * Numbers, booleans and `null` pass through untouched; the result has the
 * same shape as the input, with the same number of fields.
 *
 * The walk keeps its own work list rather than recursing. A user attribute
 * holds arbitrary JSON, and a few thousand levels of nesting — which
 * `JSON.parse` and `JSON.stringify` both accept — would otherwise exhaust the
 * call stack, letting one writer make `list` and `get` fail for every reader.
 */
export function sanitizeResponse<T>(value: T): T {
  const pending: Pending[] = [];
  const copy = (item: unknown): unknown => {
    if (typeof item === "string") {
      return escapeControlCharacters(item);
    }
    if (typeof item !== "object" || item === null) {
      return item;
    }
    const target = Array.isArray(item) ? [] : {};
    pending.push({ source: item, target });
    return target;
  };

  const root = copy(value);
  for (let next = pending.pop(); next; next = pending.pop()) {
    const { source, target } = next;
    if (Array.isArray(source)) {
      for (const item of source) {
        (target as unknown[]).push(copy(item));
      }
      continue;
    }
    for (const [key, item] of Object.entries(source)) {
      // Defined rather than assigned, so a `__proto__` key stays a field.
      Object.defineProperty(target, escapeKey(key), {
        value: copy(item),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return root as T;
}

/**
 * Rebuild a rejected call's {@link ApiError} with the server's text escaped.
 * The error envelope's `message` and `details` are printed as the failure, so
 * they are as attacker-influenceable as any response body. It stays an
 * `ApiError`, with the same status and URL, so `toZitadelError` classifies it
 * as before.
 */
function sanitizeRejection(error: unknown): never {
  if (!(error instanceof ApiError)) {
    throw error;
  }
  const sanitized = new ApiError(
    error.status,
    error.url,
    sanitizeResponse(error.body),
    escapeControlCharacters(error.message),
  );
  sanitized.stack = error.stack === undefined ? undefined : escapeControlCharacters(error.stack);
  throw sanitized;
}

/** Options for {@link createZitadelClient}. */
export type SanitizeOptions = {
  /**
   * Return response bodies exactly as the server sent them. Only for a
   * caller that stores or compares what it reads rather than printing it:
   * `apply` and `setup` write the server's canonical body back to the
   * project's files, and `plan` diffs it against them, so an escaped
   * `\r` or zero-width joiner would be written to disk as literal text and
   * published as a change. Such a caller escapes at the point it prints.
   * Errors are escaped either way.
   */
  verbatim?: boolean;
};

/**
 * Build the typed Zitadel client the CLI talks to the server through.
 *
 * It is `@zitadel/api`'s client with every resolved response, and every
 * server-supplied error, passed through {@link sanitizeResponse} — the approach
 * the GitHub CLI takes with go-gh's `asciisanitizer`, widened to the format
 * and bidi controls that can disguise text. Doing it once here, rather than
 * in each renderer, covers every command, table, detail view and `--json`
 * envelope, including ones not yet written; only a caller that asks for
 * {@link SanitizeOptions.verbatim} bodies escapes for itself. The shared
 * package is left raw: the console renders into a DOM, which does not
 * interpret escape codes.
 */
export function createZitadelClient(
  opts: ZitadelClientOptions,
  sanitize: SanitizeOptions = {},
): ZitadelClient {
  const onResolve = sanitize.verbatim ? <T>(value: T): T => value : sanitizeResponse;
  const client = createRawClient(opts);
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown)(...args);
        return result instanceof Promise ? result.then(onResolve, sanitizeRejection) : result;
      };
    },
  });
}

export type { ZitadelClient, ZitadelClientOptions };
