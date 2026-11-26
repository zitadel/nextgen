import { PmCommandFailedError, PmCommandNotPermittedError, PmManifestInvalidError } from "@/lib/pm";

import type { Refusal } from "@/cli/core/refusal";
import type { Wording } from "./wording";

/** How a `package.json` that cannot be read as one is refused. */
const MANIFEST_INVALID_REFUSAL = {
  message: "{message}",
} as const satisfies Refusal;

/** How a package manager command that failed is refused. */
const COMMAND_FAILED_REFUSAL = {
  message: "{message}",
} as const satisfies Refusal;

/** How a package manager command the operating system would not run is refused. */
const COMMAND_NOT_PERMITTED_REFUSAL = {
  message: "{message}",
  hint: "Check file permissions or run with the right user.",
} as const satisfies Refusal;

/** How the errors of `@/lib/pm` are worded, most specific class first. */
export const PM_WORDINGS: readonly Wording[] = [
  [PmManifestInvalidError, MANIFEST_INVALID_REFUSAL],
  [PmCommandNotPermittedError, COMMAND_NOT_PERMITTED_REFUSAL],
  [PmCommandFailedError, COMMAND_FAILED_REFUSAL],
];
