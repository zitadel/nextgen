/**
 * Everything the CLI draws.
 *
 * This is the only place `@clack/prompts` and `consola` are drawn with, so that
 * every command's output has the same shape however its own code is written.
 * Commands reach it as `this.ui` ({@link Ui}); nothing else constructs one.
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
 * Layout ({@link Prose}, {@link Facts}, {@link Frame}) is pure string work: each
 * piece renders itself, so the output is unit-tested without a terminal.
 */
export type { Audience } from "./audience";
export { Facts, Frame, Prose, type Renderable, WIDTH } from "./layout";
export { Where } from "./where";
export { GUIDE, MARK } from "./marks";
export type {
  Choice,
  ConfirmQuestion,
  MultiselectQuestion,
  SecretQuestion,
  SelectQuestion,
  TextQuestion,
} from "./questions";
export type { Fact, Outcome, Section, Summary } from "./summary";
export { outcome, section } from "./summary";
export { Ui } from "./ui";
export type { Report, Step, Wizard } from "./wizard";
