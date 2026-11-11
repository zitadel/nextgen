import { SETUP_PRESETS, type SetupPreset } from "@zitadel/config/defaults";

import type { PromptContext, SetupAnswers, SetupPrompt } from "./types";

/**
 * "Which sign-in method would you like your users to see first?" — picks the schema+flow preset the scaffold
 * starts from (#448: app-type/preset selection before any `.zitadel/` file
 * is written). `--preset` is authoritative; non-interactive runs keep the
 * password-first default seeded by the command.
 */
export class SignInPresetPrompt implements SetupPrompt {
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    if (ctx.presetFromFlag) {
      return answers;
    }
    // Each label says what users see first and what is secondary, because
    // both presets enable password and passkey in the schema: the choice is
    // only which one the login flow shows first.
    const labels: Record<SetupPreset, string> = {
      "password-first": "Email and password, with passkeys enabled but not shown at sign-in",
      "passkey-first": "Passkey, with email and password shown as the alternative",
    };
    const preset = await ctx.input({
      kind: "select",
      name: "sign-in preset",
      message: "Which sign-in method would you like your users to see first?",
      initialValue: answers.preset,
      options: SETUP_PRESETS.map((preset) => ({ value: preset, label: labels[preset] })),
    });
    return { ...answers, preset };
  }
}
