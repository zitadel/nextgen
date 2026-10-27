/**
 * Who is on the other side of a command, which decides whether anything is
 * drawn at all.
 *
 * There is exactly one audience per invocation, built by `BaseCommand` from the
 * flags it parsed, and every part of the UI reads it rather than deciding for
 * itself: a module that consults `process.stdout.isTTY` on its own is a module
 * that can disagree with the rest.
 */
export type Audience = {
  /**
   * Whether a person is watching. False under `--json`, under
   * `--non-interactive`, and when stdout or stdin is not a terminal. When it is
   * false the chain draws nothing, questions are answered from flags and piped
   * stdin only, and narration falls back to plain `consola` lines, which
   * `--json` silences in turn, so the envelope travels alone on stdout.
   */
  readonly interactive: boolean;
  /**
   * The command's `--force`, which answers its confirmations yes without
   * asking. A command whose `--force` means something else (setup's overwrites
   * files) opens its wizard with `honorForce: false`, which drops it for that
   * command without touching the invocation's audience.
   */
  readonly force: boolean;
};
