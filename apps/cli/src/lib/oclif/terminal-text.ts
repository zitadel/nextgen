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
type Pending = {
  source: object;
  target: Record<string, unknown> | unknown[];
};

/**
 * What `JSON.stringify` would serialise in place of an object: its `toJSON`,
 * when it has one.
 *
 * Called once and never again on the result, exactly as the serialiser does, so
 * a `toJSON` answering another object that carries one leaves the second alone.
 * Without this an object that serialises to something other than its own
 * fields — an entity answering the record the API sent, a `Date` answering its
 * ISO spelling — would be copied field by field instead, which both loses what
 * it meant to answer and discloses the fields it keeps to itself.
 *
 * @param item - The object about to be copied.
 * @returns What to copy in its place.
 */
function serialized(item: object): unknown {
  const method = (item as { toJSON?: unknown }).toJSON;
  if (typeof method !== "function") {
    return item;
  }
  return (method as (this: object) => unknown).call(item);
}

/**
 * Escape every string in a value about to be written out as JSON, keys
 * included, at any depth. Numbers, booleans and `null` pass through untouched,
 * and an object is taken as {@link serialized} gives it, so the result holds
 * what `JSON.stringify` would have written and nothing else.
 *
 * Keys are not escaped idempotently, because a key's backslashes are doubled,
 * so this runs once over what is about to be written out and never over a
 * value that has been through it already.
 *
 * The walk keeps its own work list rather than recursing. A user attribute
 * holds arbitrary JSON, and a few thousand levels of nesting — which
 * `JSON.parse` and `JSON.stringify` both accept — would otherwise exhaust the
 * call stack, letting one writer make `list` and `get` fail for every reader.
 *
 * @param value - The value about to be written out.
 * @returns A copy with every string escaped.
 */
export function escapeControlCharactersDeep<T>(value: T): T {
  const pending: Pending[] = [];
  const copy = (given: unknown): unknown => {
    const item = typeof given === "object" && given !== null ? serialized(given) : given;
    if (typeof item === "string") {
      return escapeControlCharacters(item);
    }
    if (typeof item !== "object" || item === null) {
      return item;
    }
    const target = Array.isArray(item) ? [] : {};
    pending.push({
      source: item,
      target,
    });
    return target;
  };

  const root = copy(value);
  // Iterating the array also visits the entries `copy` appends meanwhile.
  for (const { source, target } of pending) {
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
