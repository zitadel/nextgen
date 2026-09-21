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
   * a value on one line (a table cell, a tab-separated row) turns it off.
   */
  keepLayout?: boolean;
};

/**
 * Escape every character that could drive the reader's terminal to its
 * visible `\xNN`/`\uNNNN` spelling.
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
    return code <= 0xff
      ? `\\x${code.toString(16).padStart(2, "0")}`
      : `\\u${code.toString(16).padStart(4, "0")}`;
  });
}

/**
 * Escape every string in a decoded JSON value, keys included, at any depth.
 * Numbers, booleans and `null` pass through untouched; the result has the
 * same shape as the input.
 */
export function sanitizeResponse<T>(value: T): T {
  if (typeof value === "string") {
    return escapeControlCharacters(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => sanitizeResponse(item)) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        escapeControlCharacters(key),
        sanitizeResponse(item),
      ]),
    ) as T;
  }
  return value;
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
  sanitized.stack = error.stack;
  throw sanitized;
}

/**
 * Build the typed Zitadel client the CLI talks to the server through.
 *
 * It is `@zitadel/api`'s client with every resolved response, and every
 * server-supplied error, passed through {@link sanitizeResponse} — the fix the
 * GitHub CLI made in go-gh's `asciisanitizer`. Doing it once here, rather than
 * in each renderer, covers every command, table, detail view and `--json`
 * envelope, including ones not yet written. The shared package is left raw:
 * the console renders into a DOM, which does not interpret escape codes.
 */
export function createZitadelClient(opts: ZitadelClientOptions): ZitadelClient {
  const client = createRawClient(opts);
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown)(...args);
        return result instanceof Promise
          ? result.then(sanitizeResponse, sanitizeRejection)
          : sanitizeResponse(result);
      };
    },
  });
}

export type { ZitadelClient, ZitadelClientOptions };
