import type { Questions } from "../../../lib/ui";

/**
 * "Which framework would you like to scaffold?" — the only prompt outside the main wizard.
 * Runs at the empty-directory branch (before any other detection). Returns the chosen framework id; choices come from
 * `Orca.availableFrameworks`.
 */
export class PickFrameworkPrompt {
  async ask(
    choices: ReadonlyArray<{ id: string; displayName: string }>,
    ask: Questions,
  ): Promise<string> {
    return ask.select({
      name: "framework",
      message: "Which framework would you like to scaffold?",
      options: choices.map((choice) => ({ value: choice.id, label: choice.displayName })),
    });
  }
}
