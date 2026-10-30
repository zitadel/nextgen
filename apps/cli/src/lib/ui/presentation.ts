/**
 * Which of the two shapes a command's output takes.
 *
 * It is a property of the command and nothing else. A command declares it
 * once (`static wizard` on `BaseCommand`) and every part of the UI reads it,
 * so the same command looks the same on every run: a question it happened to
 * ask, a warning it happened to report, or a `--force` that spared it a
 * question cannot turn one shape into the other.
 *
 * - `wizard`: the handful of commands that walk a person through something —
 *   `setup`, `deploy`, `pull`, `doctor`, `status`, `env add`, `eject`,
 *   `branding eject`, `claim`, `auth-method sso enable`. They open a chain
 *   (`┌`/`│`/`└`), draw their questions in it, and close on a summary box.
 * - `plain`: every other command. It draws no chain and no box, ever: a
 *   question is one undecorated line with the answer typed on it, and the run
 *   ends with its answer at the left margin and one dim footer line.
 */
export type Presentation = "wizard" | "plain";
