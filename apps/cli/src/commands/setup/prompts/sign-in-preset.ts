import { SETUP_PRESETS, type SetupPreset } from "@zitadel/config/defaults";

import type { PromptContext, SetupAnswers, SetupPrompt } from "./types";

/**
 * "How should users sign in?" — picks the schema+flow preset the scaffold
 * starts from (#448: app-type/preset selection before any `.zitadel/` file
 * is written). `--preset` is authoritative; non-interactive runs keep the
 * password-first default seeded by the command.
 */
export class SignInPresetPrompt implements SetupPrompt {
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    if (ctx.presetFromFlag) {
      return answers;
    }
    const labels: Record<SetupPreset, string> = {
      "password-first": "Password first (email and password)",
      "passkey-first": "Passkey first (one-tap passkey, with email and password as a fallback)",
    };
    const preset = await ctx.input({
      kind: "select",
      name: "sign-in preset",
      message: "How should users sign in?",
      initialValue: answers.preset,
      options: SETUP_PRESETS.map((preset) => ({ value: preset, label: labels[preset] })),
    });
    return { ...answers, preset };
  }
}
