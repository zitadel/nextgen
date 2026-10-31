/**
 * What a command suggests doing next, and the one place it is shown.
 *
 * A command never writes its next steps into its data or prints them: it
 * hands them to `emit` as the result's `next`, and the base command puts them
 * in the envelope and prints every one of them at the end of the run. Nothing
 * here knows which CLI it serves; the command type is the caller's.
 */

/**
 * A result's next steps. `actions` is prose for whoever reads the result and
 * `commands` is what to run; the two are independent lists. A list left
 * `undefined` is left out of the envelope, while an empty one is emitted
 * empty, so a command decides which of the two its contract promises.
 */
export type NextSteps<C extends string = string> = {
  readonly actions?: readonly string[];
  readonly commands?: readonly C[];
};

declare const stepsShown: unique symbol;

/**
 * Proof that a command printed its next steps itself, inside output of its
 * own such as a summary box. Only the code that drew them makes one, right
 * after drawing them, so a result can skip the trailing block only by having
 * shown the steps.
 */
export type StepsShown = { readonly [stepsShown]: true };

/** Made right after a command printed its next steps itself; nothing else calls it. */
export function asStepsShown(): StepsShown {
  return {} as StepsShown;
}

/**
 * The steps as envelope keys: `next_actions` and `next_commands`, each one
 * present exactly when the command set that list.
 */
export function nextStepsData<C extends string>(
  next: NextSteps<C>,
): { next_actions?: string[]; next_commands?: C[] } {
  return {
    ...(next.actions === undefined ? {} : { next_actions: [...next.actions] }),
    ...(next.commands === undefined ? {} : { next_commands: [...next.commands] }),
  };
}

/**
 * The block a run ends with: the prose, then each command on a `$` line, or
 * `""` when there is nothing to do next.
 */
export function renderNextSteps(next: NextSteps): string {
  const actions = next.actions ?? [];
  const commands = next.commands ?? [];
  if (actions.length === 0 && commands.length === 0) {
    return "";
  }
  return [
    "Next:",
    ...actions.map((action) => `  ${action}`),
    ...commands.map((command) => `  $ ${command}`),
  ].join("\n");
}
