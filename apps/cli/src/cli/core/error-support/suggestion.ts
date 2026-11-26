import { SuggestionInvalidError } from "@/lib/suggestion";

import type { Refusal } from "@/cli/core/refusal";
import type { Wording } from "./wording";

/** How a follow-up that cannot be rendered is reported, with the failure it is. */
const INVALID_REFUSAL = {
  message: "{message}",
  details: {
    original: "{original}",
  },
} as const satisfies Refusal;

/** How the errors of `@/lib/suggestion` are worded. */
export const SUGGESTION_WORDINGS: readonly Wording[] = [[SuggestionInvalidError, INVALID_REFUSAL]];
