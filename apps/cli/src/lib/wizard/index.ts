/**
 * A generic engine for flows made of steps.
 *
 * A flow is an ordered list of steps, each a class that reads what earlier
 * steps settled, does one thing, adds the facts it produces and undoes its own
 * work if a later step fails. The compiler checks that every step's needs are
 * given by an earlier one, and that no two steps share a name.
 *
 * It draws nothing and asks nothing: a step reaches the terminal through what
 * its own constructor was given. Nothing here imports the CLI, so the engine can
 * be lifted out unchanged.
 */
export { EndStep, WizardStep } from "./step";
export {
  type Observer,
  ReadyWizard,
  type RunOptions,
  type Unmet,
  Wizard,
  WizardDefinitionError,
} from "./wizard";
