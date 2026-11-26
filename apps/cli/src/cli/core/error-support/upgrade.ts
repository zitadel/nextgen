import { UpgradeInstallFailedError, UpgradeReleaseLookupError } from "@/lib/upgrade";

import type { Refusal } from "@/cli/core/refusal";
import type { Wording } from "./wording";

/** How a release that cannot be looked up is refused. */
const RELEASE_LOOKUP_REFUSAL = {
  message: "{message}",
  details: {
    original: "{original}",
  },
} as const satisfies Refusal;

/** How an install of the new packages that failed is refused. */
const INSTALL_FAILED_REFUSAL = {
  message: "{message}",
  details: {
    original: "{original}",
  },
} as const satisfies Refusal;

/**
 * How the errors of `@/lib/upgrade` are worded, most specific class first. The
 * `upgrade` command words both itself, since what to run again is its own run.
 */
export const UPGRADE_WORDINGS: readonly Wording[] = [
  [UpgradeReleaseLookupError, RELEASE_LOOKUP_REFUSAL],
  [UpgradeInstallFailedError, INSTALL_FAILED_REFUSAL],
];
