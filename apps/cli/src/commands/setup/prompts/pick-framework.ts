import { intro } from "@clack/prompts";

import type { Asker } from "../../../lib/input";

/**
 * "Which framework would you like to scaffold?" — the only prompt outside the main wizard.
 * Runs at the empty-directory branch (before any other detection), so it owns
 * its own `intro` heading. Returns the chosen framework id; choices come from
 * `Orca.availableFrameworks`.
 */
export class PickFrameworkPrompt {
  async ask(
    choices: ReadonlyArray<{ id: string; displayName: string }>,
    ask: Asker,
  ): Promise<string> {
    intro("Zitadel setup — new project");
    return ask({
      kind: "select",
      name: "framework",
      message: "Which framework would you like to scaffold?",
      options: choices.map((choice) => ({ value: choice.id, label: choice.displayName })),
    });
  }
}
