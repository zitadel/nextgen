import { ConsentRequiredError } from "@/lib/consent";

import type { Refusal } from "@/cli/core/refusal";
import type { Wording } from "./wording";

/** How a destructive action stopped for want of consent is refused. */
const REQUIRED_REFUSAL = {
  message: "{message}",
} as const satisfies Refusal;

/**
 * How the errors of `@/lib/consent` are worded. `ConsentInternalError` is a
 * bug in the package, not a refusal, so it has none.
 */
export const CONSENT_WORDINGS: readonly Wording[] = [[ConsentRequiredError, REQUIRED_REFUSAL]];
