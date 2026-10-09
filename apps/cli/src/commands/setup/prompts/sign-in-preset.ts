import { select } from "@clack/prompts";

import { SETUP_PRESETS, type SetupPreset } from "@zitadel/config/defaults";

import { bail } from "./cancel";
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
      "password-first": "Password first — email + password, passkey optional during registration",
      "passkey-first": "Passkey first — one-tap passkey up front, email + password fallback",
    };
    const value = await select({
      message: "How should users sign in?",
      initialValue: answers.preset,
      options: SETUP_PRESETS.map((preset) => ({ value: preset, label: labels[preset] })),
    });
    bail(value);
    return { ...answers, preset: value as SetupPreset };
  }
}
