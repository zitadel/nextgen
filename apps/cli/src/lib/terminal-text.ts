/**
 * The two format characters a word is spelled with, which are text rather than
 * something a terminal acts on: the zero-width joiner, which builds one emoji
 * out of several, and the zero-width non-joiner, which is how Arabic and Indic
 * words are written. Spelling them out broke a name into its parts and an
 * escape sequence, so they are kept while the rest of `\p{Cf}` is not — the
 * bidi overrides reorder what a reader sees, and the tag characters hide text
 * in it, which is how a prompt is smuggled past an agent reading this output.
 */
const SPELLING = "\\u200c\\u200d";

/**
 * Characters that can drive a terminal rather than print on it: the C0
 * controls (ESC among them), DEL and the C1 controls (`\p{Cc}`), the format
 * and bidi controls (`\p{Cf}`), and the line and paragraph separators, less
 * the {@link SPELLING} pair. Newline and tab are left alone unless the caller
 * asks otherwise, because they are how a description or a multi-line value is
 * written.
 */
const CONTROL = new RegExp(`[[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]--[${SPELLING}]]`, "gv");

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
 * The characters that still reach a terminal through serialised JSON: `DEL`,
 * the C1 controls, the format and bidi controls and the line and paragraph
 * separators, less the {@link SPELLING} pair for the same reason.
 *
 * `JSON.stringify` spells out the C0 controls, `ESC` among them, because the
 * JSON grammar requires it — but it writes these as themselves, and a reader
 * printing the output then hands them to their terminal. The one thing this
 * does not share with {@link CONTROL} is C0, left out on purpose: by the time
 * this runs, the only C0 left is the colour the renderer added, and spelling
 * that out would print the sequence instead of painting.
 */
const JSON_CONTROL = new RegExp(
  `[[\\p{Cf}\\p{Zl}\\p{Zp}\\u007f\\u0080-\\u009f]--[${SPELLING}]]`,
  "gv",
);

/**
 * Spell out, as the `\uNNNN` escape JSON already uses, every character that
 * would otherwise reach a terminal as itself through serialised JSON.
 *
 * Applied to the serialised text rather than to the values, so what a reader
 * parses back is the character the server sent, byte for byte, while what a
 * reader prints cannot drive their terminal. A value is never changed, only
 * the way it is written down.
 *
 * A `\u` escape carries exactly four hex digits, so a character above the BMP
 * is written as the surrogate pair JSON spells it with rather than as its code
 * point: the tag characters are such a character, and they are the ones this
 * exists for, so writing `1` would parse back as U+E000 and a `1` and
 * quietly change the value it was protecting.
 *
 * @param json - The serialised JSON, already coloured if it is going to be.
 * @returns The same JSON, with those characters written as escapes.
 */
export function escapeJsonControlCharacters(json: string): string {
  return json.replace(JSON_CONTROL, (char) => {
    // The `v` flag matches whole code points, so an astral character arrives
    // as both of its units and each is spelled out in turn.
    return Array.from({ length: char.length }, (_unit, index) => {
      return `\\u${char.charCodeAt(index).toString(16).padStart(4, "0")}`;
    }).join("");
  });
}
