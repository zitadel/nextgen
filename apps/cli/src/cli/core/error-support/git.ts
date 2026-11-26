import { GitBinaryMissingError, GitCommandFailedError } from "@/lib/git";

import type { Refusal } from "@/cli/core/refusal";
import type { Wording } from "./wording";

/** How a run is refused when git cannot be started. */
const BINARY_MISSING_REFUSAL = {
  message: "{message}",
} as const satisfies Refusal;

/** How a run is refused when git fails for a reason nothing handles. */
const COMMAND_FAILED_REFUSAL = {
  message: "{message}",
} as const satisfies Refusal;

/**
 * How the errors of `@/lib/git` are worded, most specific class first.
 * `GitInternalError` is a bug in the package, not a refusal, so it has none.
 */
export const GIT_WORDINGS: readonly Wording[] = [
  [GitBinaryMissingError, BINARY_MISSING_REFUSAL],
  [GitCommandFailedError, COMMAND_FAILED_REFUSAL],
];
