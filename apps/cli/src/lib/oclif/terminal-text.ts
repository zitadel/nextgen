import consola, { type ConsolaReporter } from "consola";

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

/** Each reporter already wrapped, so installing twice never wraps one twice. */
const escaping = new WeakSet<ConsolaReporter>();

/**
 * A reporter that escapes a message's text and hands it on.
 *
 * Only the strings are escaped. Anything else consola formats through
 * `util.inspect`, which already spells a control character inside a value out
 * as `\x1b`, so escaping it here would double the backslash of what it wrote.
 *
 * @param reporter - The reporter that prints.
 * @returns A reporter that escapes first.
 */
function escapingReporter(reporter: ConsolaReporter): ConsolaReporter {
  const wrapper: ConsolaReporter = {
    log(logObj, ctx) {
      return reporter.log(
        {
          ...logObj,
          args: logObj.args.map((arg: unknown) => {
            return typeof arg === "string" ? escapeControlCharacters(arg) : arg;
          }),
        },
        ctx,
      );
    },
  };
  escaping.add(wrapper);
  return wrapper;
}

/**
 * Escape everything consola prints, whichever call printed it.
 *
 * `BaseCommand.emit` escapes what a command answers, but a command also
 * narrates its steps through consola, and a step names what the server said —
 * the project it created, the schema it wrote. Those calls reach the terminal
 * without going through `emit`, and there are dozens of them, so the escaping
 * belongs to the reporter rather than to each call: a narration added later is
 * covered by having been printed at all.
 *
 * The reporters consola already has keep doing the printing, glyphs and boxes
 * included; this only wraps them. Escaping a value twice spells it the same
 * way, so a caller that escaped its own text (`reportWarning`, which needs the
 * escaped spelling for the envelope as well) is unharmed.
 */
export function escapeConsolaMessages(): void {
  consola.setReporters(
    consola.options.reporters.map((reporter) => {
      return escaping.has(reporter) ? reporter : escapingReporter(reporter);
    }),
  );
}
