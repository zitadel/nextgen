/**
 * How this process's output is drawn, decided once by the base command and
 * read by whatever writes: a diff that is painted, a release published while
 * stdout belongs to the envelope.
 *
 * A command never reads the mode itself and never hands it on, so the one
 * place that knows `--json`, `--color`, `--no-color` and `NO_COLOR` is the base
 * command. The defaults are a plain, human run, which is what a library used
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
