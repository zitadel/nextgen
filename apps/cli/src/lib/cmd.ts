/**
 * A command line, held as a list of words.
 *
 * The CLI prints commands for a person or an agent to paste into a shell: the
 * next step after a command, the retry a refusal suggests, the `--force`
 * form of a deletion. The values in them come from the project or the server
 * (an origin, a page cursor, a directory), so they are not trusted: origin
 * validation permits shell metacharacters, and a value such as one containing
 * `$(...)` must never reach a shell as written. A `Cmd` quotes every word
 * when the line is turned into text, so a caller cannot forget to.
 *
 * A `Cmd` is immutable. Its words are copied and frozen when it is made, the
 * instance itself is frozen, and every method that changes the line returns a
 * new `Cmd` and leaves the one it was called on as it was.
 *
 * @example
 * const retry = Cmd.of(["origin", "rm", "my origin", "--cwd", "app"]).without(["--cwd", "-c"]);
 * retry.toString(); // "origin rm 'my origin'"
 */
export class Cmd {
  private readonly words: readonly string[];

  private constructor(words: readonly string[]) {
    this.words = Object.freeze([...words]);
    Object.freeze(this);
  }

  /**
   * A command line made of `words`, as the shell should receive them: one
   * word each, unquoted. The words are copied, so changing the array that
   * was passed in later does not change the line.
   *
   * @param words - The command's words in order, such as `["origin", "rm", url]`.
   */
  static of(words: readonly string[]): Cmd {
    return new Cmd(words);
  }

  /**
   * `value` as one shell word. A value made only of shell-safe characters is
   * returned as it is. Anything else is wrapped in single quotes, with each
   * embedded single quote written as `'\''` (close the quote, an escaped
   * quote, reopen it), which is the one form every POSIX shell reads the same
   * way.
   *
   * @param value - Any text, trusted or not.
   * @example
   * Cmd.quote("http://localhost:3000"); // "http://localhost:3000"
   * Cmd.quote("$(whoami)"); // "'$(whoami)'"
   * Cmd.quote("it's"); // "'it'\\''s'"
   */
  static quote(value: string): string {
    const isSafe = /^[A-Za-z0-9_.:@/=+-]+$/.test(value);
    if (isSafe) {
      return value;
    }
    return `'${value.replaceAll("'", `'\\''`)}'`;
  }

  /**
   * An option and its value for a command's text: `--cwd path`, but
   * `--cwd=-path` for a value that starts with a dash. A separate token would
   * be read as the next option rather than as this one's value, and quoting
   * does not prevent that (`--cwd '--force'` still parses as two options), so
   * the value is joined with `=`, which no parser splits. The value is quoted
   * like any word. The argument-list form of the same rule is `optionArgs` in
   * `public-cli.ts`.
   *
   * @param option - The option as it is spelled, such as `--cwd`.
   * @param value - Its value.
   * @example
   * Cmd.option("--cwd", "/home/dev/app"); // "--cwd /home/dev/app"
   * Cmd.option("--cwd", "--force"); // "--cwd=--force"
   * Cmd.option("--env-file", "my env.local"); // "--env-file 'my env.local'"
   */
  static option(option: string, value: string): string {
    const quoted = Cmd.quote(value);
    if (value.startsWith("-")) {
      return `${option}=${quoted}`;
    }
    return `${option} ${quoted}`;
  }

  /**
   * This line without the named options, each with its value, whether the
   * line spells it `--cwd dir` or `--cwd=dir`. A short option (`-c`) is only
   * recognised as a separate word followed by its value. It is for a line that
   * is rebuilt with those options put back in their own way, so a retry does
   * not carry a stale copy of what the run adds itself.
   *
   * The instance it is called on is not changed.
   *
   * @param options - The options to remove, as spelled: `["--cwd", "-c"]`.
   * @returns A new line, or an equal one when none of the options was present.
   */
  without(options: readonly string[]): Cmd {
    return new Cmd(Cmd.stripped(this.words, options));
  }

  /**
   * The line as text a shell reads back as the same words: each word through
   * {@link Cmd.quote}, joined with single spaces.
   */
  toString(): string {
    return this.words
      .map((word) => {
        return Cmd.quote(word);
      })
      .join(" ");
  }

  /**
   * `words` without the options and their values, in one pass. The loop and the
   * value-skipping share one iterator: reading an option's value out of it takes
   * that word out of the walk.
   */
  private static stripped(words: readonly string[], options: readonly string[]): string[] {
    const kept: string[] = [];
    const remaining = words.values();
    for (const word of remaining) {
      if (options.includes(word)) {
        remaining.next();
        continue;
      }
      const isInlineValue = options.some((option) => {
        return option.startsWith("--") && word.startsWith(`${option}=`);
      });
      if (!isInlineValue) {
        kept.push(word);
      }
    }
    return kept;
  }
}
