import { WizardDefinitionError } from "@/lib/wizard";

import type { Refusal } from "@/cli/core/refusal";
import type { Wording } from "./wording";

/** How a wizard put together wrongly is reported, with the failure it is. */
const DEFINITION_REFUSAL = {
  message: "{message}",
  details: {
    original: "{original}",
  },
} as const satisfies Refusal;

/** How the errors of `@/lib/wizard` are worded. */
export const WIZARD_WORDINGS: readonly Wording[] = [[WizardDefinitionError, DEFINITION_REFUSAL]];
