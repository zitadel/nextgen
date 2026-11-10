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
   * stdin only, and narration falls back to plain lines, which
   * `--json` silences in turn, so the envelope travels alone on stdout.
   */
  readonly interactive: boolean;
  /**
   * The command's `--force`, which answers a destructive confirmation yes
   * without asking. Only `Consent.request` asks one, through
   * {@link Ui.confirmer}; no question a command asks for itself is answered by
   * it, so a command whose `--force` means something else (setup's overwrites
   * files) needs nothing special.
   */
  readonly force: boolean;
};
