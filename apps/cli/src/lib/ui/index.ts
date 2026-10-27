/**
 * Everything the CLI draws.
 *
 * This is the only place `@clack/prompts` and `consola` are drawn with, and
 * the only place that writes to stdout or stderr for a person to read, so that
 * every command's output has the same shape however its own code is written.
 * Commands reach it as `this.ui` ({@link Ui}); nothing else constructs one.
 * `tests/unit/lib/ui/index.test.ts` fails on a file outside this directory
 * that draws for itself.
 *
 * One command's output, from its first line to its last:
 *
 *     ┌  Listing origins                                 ← what the command is doing
 *     │
 *     ◇  What should the value of GREETING be?           ← a question, with the answer under it
 *     │  hello
 *     │
 *     ✔  Set GREETING on the project                     ← a step that finished
 *     │  Wrote  .env.local                               ← what that step did
 *     │
 *     └  Set GREETING on the project                     ← the one line the command ends on
 *
 *        primary   hello                                 ← the facts, and then one box of
 *                                                           next steps, both outside the
 *                                                           gutter so they copy cleanly
 *
 * The parts, in the order a command meets them:
 *
 * - {@link Audience} — who is watching, which decides whether anything is drawn.
 * - {@link Ui} — the chain for one command, and `wizard(...)`, which is the
 *   only way in.
 * - {@link Wizard} — what a command may do while its chain is open: ask
 *   ({@link TextQuestion} and the other question types), {@link Wizard.note}
 *   something the person must act on, and run work as a {@link Wizard.task}.
 * - {@link Outcome} — what the command returns: the `--json` payload and the
 *   {@link Summary} the chain closes on.
 *
 * What is not exported is not for callers. The layout (how a box is framed,
 * how facts are aligned, which glyph a mark is), the chain, the `consola`
 * bridge and the spinners are reached through {@link Ui} alone: a caller that
 * could render a frame itself could render one that does not match.
 */
export type { Audience } from "./audience";
export type {
  Choice,
  ConfirmQuestion,
  MultiselectQuestion,
  SecretQuestion,
  SelectQuestion,
  TextQuestion,
} from "./questions";
export type { Spinner } from "./spinner";
export type { Fact, Outcome, Section, Summary } from "./summary";
export { outcome, section } from "./summary";
export { Ui } from "./ui";
export type { Report, Step, Wizard } from "./wizard";
