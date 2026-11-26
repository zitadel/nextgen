import {
  BackendMethodMismatchError,
  BackendOperationAmbiguousError,
  BackendOperationUnknownError,
  BackendPageMalformedError,
  BackendPathUnknownError,
  BackendReleaseContentRevokedError,
  BackendVariablePreviewMissingError,
  BackendVariablePrimaryMissingError,
} from "@/lib/backend";

import type { Refusal } from "@/cli/core/refusal";
import { derived, type Wording } from "./wording";

/** How a variable with no preview value is refused. */
const VARIABLE_PREVIEW_MISSING_REFUSAL = {
  message: "{message}",
  hint: "A name has a preview value only once one is set with `--preview`.",
} as const satisfies Refusal;

/** How a variable with no primary value is refused. */
const VARIABLE_PRIMARY_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Set one with `variable set`.",
} as const satisfies Refusal;

/** How content that was released already, as a release since revoked, is refused. */
const RELEASE_CONTENT_REVOKED_REFUSAL = {
  message: "{message}",
  hint: "A revoked release can never be served again. Change the configuration so it builds a new release.",
} as const satisfies Refusal;

/** How a path that matches no operation's template is refused. */
const PATH_UNKNOWN_REFUSAL = {
  message: "{message}",
  hint: "List the paths with `zitadel api ls`.",
  next: [
    {
      id: "api:ls",
      flags: {
        json: true,
      },
    },
  ],
} as const satisfies Refusal;

/** How an operation id that names nothing the API has is refused. */
const OPERATION_UNKNOWN_REFUSAL = {
  message: "{message}",
  hint: "{fix}",
  next: [
    {
      id: "api:ls",
      flags: {
        json: true,
      },
    },
  ],
} as const satisfies Refusal;

/** How an operation id given a method that is not its own is refused. */
const METHOD_MISMATCH_REFUSAL = {
  message: "{message}",
  hint: "Leave out -X, or pass -X {method}.",
  next: [
    {
      id: "api:ls",
      flags: {
        json: true,
      },
    },
  ],
} as const satisfies Refusal;

/** How a path whose method does not pick one operation is refused. */
const OPERATION_AMBIGUOUS_REFUSAL = {
  message: "{message}",
  hint: "Pass -X with one of {offered}.",
  next: [
    {
      id: "api:ls",
      flags: {
        json: true,
      },
    },
  ],
} as const satisfies Refusal;

/** How a page that does not hold the list its operation pages through is refused. */
const PAGE_MALFORMED_REFUSAL = {
  message: "{message}",
} as const satisfies Refusal;

/**
 * How the errors of `@/lib/backend` are worded, most specific class first.
 *
 * Only the classes the CLI raises with facts of its own are worded here. Every
 * other backend error is the server's answer, which `toZitadelError` words
 * from the status and the body the server sent.
 */
export const BACKEND_WORDINGS: readonly Wording[] = [
  [BackendVariablePreviewMissingError, VARIABLE_PREVIEW_MISSING_REFUSAL],
  [BackendVariablePrimaryMissingError, VARIABLE_PRIMARY_MISSING_REFUSAL],
  [BackendReleaseContentRevokedError, RELEASE_CONTENT_REVOKED_REFUSAL],
  [BackendPathUnknownError, PATH_UNKNOWN_REFUSAL],
  derived(BackendOperationUnknownError, OPERATION_UNKNOWN_REFUSAL, (error) => {
    return {
      values: {
        fix:
          error.near.length > 0
            ? `Did you mean ${error.near.join(", ")}? List them all with \`zitadel api ls\`.`
            : "List them with `zitadel api ls`, or give a path such as /users/query.",
      },
    };
  }),
  [BackendMethodMismatchError, METHOD_MISMATCH_REFUSAL],
  derived(BackendOperationAmbiguousError, OPERATION_AMBIGUOUS_REFUSAL, (error) => {
    return {
      values: {
        offered: error.methods.join(", "),
      },
    };
  }),
  [BackendPageMalformedError, PAGE_MALFORMED_REFUSAL],
];
