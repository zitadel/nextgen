import { intro, select } from "@clack/prompts";

import { bail } from "./cancel";

/**
 * "Choose a framework to scaffold" — the only prompt outside the main wizard.
 * Runs at the empty-directory branch (before any other detection), so it owns
 * its own `intro` heading. Returns the chosen framework id; choices come from
 * `Orca.availableFrameworks`.
 */
export class PickFrameworkPrompt {
  async ask(
    choices: ReadonlyArray<{ id: string; displayName: string }>,
  ): Promise<string> {
    intro("Zitadel setup — new project");
    const picked = await select({
      message: "Choose a framework to scaffold",
      options: choices.map((choice) => ({ value: choice.id, label: choice.displayName })),
    });
    bail(picked);
    return picked as string;
  }
}
