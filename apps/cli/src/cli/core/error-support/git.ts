import { GitBinaryMissingError, GitCommandFailedError, GitInternalError } from "@/lib/git";

import type { Refusal } from "@/cli/core/refusal";
import type { Wording } from "./wording";

/** How a run is refused when git cannot be started. */
const BINARY_MISSING_REFUSAL = {
  message: "{message}",
  details: {
    original: "{original}",
  },
} as const satisfies Refusal;

/** How a run is refused when git fails for a reason nothing handles. */
const COMMAND_FAILED_REFUSAL = {
  message: "{message}",
  details: {
    original: "{original}",
  },
} as const satisfies Refusal;

/**
 * How the errors of `@/lib/git` are worded, most specific class first.
 * `GitInternalError` is a bug in the package, not a refusal, so it has none.
 */
/** How a bug in the git package is reported. */
const INTERNAL_REFUSAL = {
  message: "{message}",
  details: {
    original: "{original}",
  },
} as const satisfies Refusal;

export const GIT_WORDINGS: readonly Wording[] = [
  [GitBinaryMissingError, BINARY_MISSING_REFUSAL],
  [GitCommandFailedError, COMMAND_FAILED_REFUSAL],
  [GitInternalError, INTERNAL_REFUSAL],
];
