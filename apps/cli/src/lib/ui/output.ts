/**
 * How this process's output is drawn, decided once by the base command and
 * read by whatever writes: a diff that is painted, a release published while
 * stdout belongs to the envelope.
 *
 * The one place that decides `--json`, `--color`, `--no-color` and `NO_COLOR` is
 * the base command, which settles this once; a command asks here rather than
 * recomputing it from the process, and a library that starts a child process or
 * paints a diff reads its default from here. The defaults are a plain, human
 * run, which is what a library used
 * on its own gets.
 */
const mode = {
  json: false,
  color: false,
};

/**
 * The output mode of this run: read it as `Output.json` and `Output.color`;
 * only the base command calls {@link Output.settle}.
 */
export const Output = {
  /**
   * Whether this run answers in the JSON envelope, so stdout belongs to it
   * and anything else that writes must go beside it.
   *
   * @returns True under `--json`.
   */
  get json(): boolean {
    return mode.json;
  },

  /**
   * Whether human output is coloured. Never true under `--json`.
   *
   * @returns True when colour is on.
   */
  get color(): boolean {
    return mode.color;
  },

  /**
   * Whether stdout is a terminal, which is where a person reads it. Asked of
   * stdout alone, so it says what to draw, where whether anyone can be asked a
   * question is another matter.
   *
   * @returns True when stdout is a terminal.
   */
  get screen(): boolean {
    return Boolean(process.stdout.isTTY);
  },

  /**
   * Records how this run draws its output.
   *
   * @param settled - Whether the run answers in JSON, and whether it is coloured.
   * @param settled.json - Whether the run answers in the JSON envelope.
   * @param settled.color - Whether human output is coloured.
   */
  settle(settled: { json: boolean; color: boolean }): void {
    mode.json = settled.json;
    mode.color = settled.color;
  },
};
