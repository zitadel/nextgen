import {
  PmCommandFailedError,
  PmCommandMissingError,
  PmCommandNotPermittedError,
  PmManifestInvalidError,
} from "@/lib/pm";

import type { Refusal } from "@/cli/core/refusal";
import { derived, type Derived, type Wording } from "./wording";

/** How a `package.json` that cannot be read as one is refused. */
const MANIFEST_INVALID_REFUSAL = {
  message: "{message}",
  details: { original: "{original}" },
} as const satisfies Refusal;

/** How a package manager command that failed is refused. */
const COMMAND_FAILED_REFUSAL = {
  message: "{message}",
  details: { original: "{command}" },
} as const satisfies Refusal;

/** How a package manager that is not installed is refused. */
const COMMAND_MISSING_REFUSAL = {
  message: "{message}",
  hint: "A required file or directory is missing.",
  details: { original: "{command}" },
} as const satisfies Refusal;

/** How a package manager command the operating system would not run is refused. */
const COMMAND_NOT_PERMITTED_REFUSAL = {
  message: "Permission denied: {message}",
  hint: "Check file permissions or run with the right user.",
  details: { original: "{command}" },
} as const satisfies Refusal;

/**
 * The command that failed as `details.original` reports it: the failure, its
 * message, and the errno or exit status it ended with.
 *
 * @param error - The failure.
 * @returns What the wording fills `{command}` with.
 */
function failedCommand(error: PmCommandFailedError): Derived {
  return {
    values: {
      command: { name: error.name, message: error.message, code: error.status },
    },
  };
}

/** How the errors of `@/lib/pm` are worded, most specific class first. */
export const PM_WORDINGS: readonly Wording[] = [
  [PmManifestInvalidError, MANIFEST_INVALID_REFUSAL],
  derived(PmCommandNotPermittedError, COMMAND_NOT_PERMITTED_REFUSAL, failedCommand),
  derived(PmCommandMissingError, COMMAND_MISSING_REFUSAL, failedCommand),
  derived(PmCommandFailedError, COMMAND_FAILED_REFUSAL, failedCommand),
];
