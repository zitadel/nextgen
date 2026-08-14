import { select } from "@clack/prompts";

import { BRANDING_DESIGNS, type BrandingDesign } from "@zitadel/config/defaults";

import { BRANDING_DESIGN_INFO } from "../../../lib/branding/designs";

import { bail } from "./cancel";
import type { PromptContext, SetupAnswers, SetupPrompt } from "./types";

/**
 * Sentinel select value for "keep the built-in login" — clack option values
 * must be strings, and `undefined` in {@link SetupAnswers.design} is the
 * real representation of that choice.
 */
const BUILT_IN = "built-in";

/**
 * "How should the login look?" — the last wizard question (#676). Asks after
 * the sign-in preset so the order tells a story: the use case owns what is
 * collected, the preset owns how users authenticate, the design owns how
 * that experience looks.
 *
 * The built-in default is preselected and writes nothing. Picking a starter
 * design forks its Liquid template into `.zitadel/branding/` and publishes
 * it as branding revision 1 — from then on the template is repo-owned and
 * stops tracking built-in improvements, so the option labels make the
 * file-write explicit and keep ownership an opt-in. `--design` is
 * authoritative; non-interactive runs keep the built-in template.
 */
export class DesignPrompt implements SetupPrompt {
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    if (ctx.designFromFlag) {
      return answers;
    }
    const value = await select({
      message:
        "How should the login look? A starter design adds its editable template to .zitadel/branding/.",
      initialValue: (answers.design as string | undefined) ?? BUILT_IN,
      options: [
        {
          value: BUILT_IN,
          label: "Built-in",
          hint: "no files added; pick a design anytime later with `branding eject`",
        },
        ...BRANDING_DESIGNS.map((design) => ({
          value: design as string,
          label: BRANDING_DESIGN_INFO[design].label,
          hint: BRANDING_DESIGN_INFO[design].hint,
        })),
      ],
    });
    bail(value);
    if (value === BUILT_IN) {
      return { ...answers, design: undefined };
    }
    return { ...answers, design: value as BrandingDesign };
  }
}
