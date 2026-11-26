import { BrowserLaunchError } from "@/lib/browser";
import { errorMessage } from "@/lib/errors";

import type { Refusal } from "@/cli/core/refusal";
import { derived, type Wording } from "./wording";

/** How a browser that could not be opened is refused: as the opener failed. */
const LAUNCH_REFUSAL = {
  message: "{reason}",
  details: {
    original: "{original}",
  },
} as const satisfies Refusal;

/** How the errors of `@/lib/browser` are worded. */
export const BROWSER_WORDINGS: readonly Wording[] = [
  derived(BrowserLaunchError, LAUNCH_REFUSAL, (error) => {
    return {
      values: {
        reason: errorMessage(error.cause ?? error),
      },
    };
  }),
];
