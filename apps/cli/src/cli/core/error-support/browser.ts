import { BrowserLaunchError } from "@/lib/browser";

import type { Refusal } from "@/cli/core/refusal";
import type { Wording } from "./wording";

/** How a browser that could not be opened is refused. */
const LAUNCH_REFUSAL = {
  message: "{message}",
} as const satisfies Refusal;

/** How the errors of `@/lib/browser` are worded. */
export const BROWSER_WORDINGS: readonly Wording[] = [[BrowserLaunchError, LAUNCH_REFUSAL]];
