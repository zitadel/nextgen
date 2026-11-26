import {
  BackendMethodMismatchError,
  BackendNameUnknownError,
  BackendOperationAmbiguousError,
  BackendOperationUnknownError,
  BackendPathUnknownError,
  BackendUnreachableError,
  BackendVariablePreviewMissingError,
  BackendVariablePrimaryMissingError,
} from "@/lib/backend";

import { type Advice, derived, type Wording } from "./wording";

/** How a server that cannot be reached is refused. */
const UNREACHABLE_ADVICE = {
  hint: "Check your connection and the server URL (ZITADEL_URL or --server).",
} as const satisfies Advice;

/** How a variable with no preview value is refused. */
const VARIABLE_PREVIEW_MISSING_ADVICE = {
  hint: "A name has a preview value only once one is set with `--preview`.",
} as const satisfies Advice;

/** How a variable with no primary value is refused. */
const VARIABLE_PRIMARY_MISSING_ADVICE = {
  hint: "Set one with `variable set`.",
} as const satisfies Advice;

/** How a path that matches no operation's template is refused. */
const PATH_UNKNOWN_ADVICE = {
  hint: "List the paths with `zitadel api ls`.",
  details: {},
  next: [
    {
      id: "api:ls",
      flags: {
        json: true,
      },
    },
  ],
} as const satisfies Advice;

/** How an operation id that names nothing the API has is refused. */
const OPERATION_UNKNOWN_ADVICE = {
  hint: "{fix}",
  details: {},
  next: [
    {
      id: "api:ls",
      flags: {
        json: true,
      },
    },
  ],
} as const satisfies Advice;

/** How an operation id given a method that is not its own is refused. */
const METHOD_MISMATCH_ADVICE = {
  hint: "Leave out -X, or pass -X {method}.",
  details: {},
  next: [
    {
      id: "api:ls",
      flags: {
        json: true,
      },
    },
  ],
} as const satisfies Advice;

/** How a path whose method does not pick one operation is refused. */
const OPERATION_AMBIGUOUS_ADVICE = {
  hint: "Pass -X with one of {offered}.",
  details: {},
  next: [
    {
      id: "api:ls",
      flags: {
        json: true,
      },
    },
  ],
} as const satisfies Advice;

/** How a name no flow or schema carries is refused, with where to list them. */
const NAME_UNKNOWN_ADVICE = {
  hint: "{fix}",
  details: {},
} as const satisfies Advice;

/** The command that lists each kind of named record, as the hint names it. */
const LISTED_BY = {
  flow: "Run `flow-definition list` to see the flows this project has.",
  schema: "Run `schema list` to see the object types this project has.",
} as const;

/**
 * How the errors of `@/lib/backend` are advised on, each for exactly its class.
 *
 * Only the classes whose advice names a command or a flag are here. A backend
 * error the server answered is worded by `toZitadelError` from its status and
 * the body the server sent; any other states itself.
 */
export const BACKEND_WORDINGS: readonly Wording[] = [
  [BackendUnreachableError, UNREACHABLE_ADVICE],
  [BackendVariablePreviewMissingError, VARIABLE_PREVIEW_MISSING_ADVICE],
  [BackendVariablePrimaryMissingError, VARIABLE_PRIMARY_MISSING_ADVICE],
  [BackendPathUnknownError, PATH_UNKNOWN_ADVICE],
  derived(BackendOperationUnknownError, OPERATION_UNKNOWN_ADVICE, (error) => {
    return {
      values: {
        fix:
          error.near.length > 0
            ? `Did you mean ${error.near.join(", ")}? List them all with \`zitadel api ls\`.`
            : "List them with `zitadel api ls`, or give a path such as /users/query.",
      },
    };
  }),
  [BackendMethodMismatchError, METHOD_MISMATCH_ADVICE],
  derived(BackendOperationAmbiguousError, OPERATION_AMBIGUOUS_ADVICE, (error) => {
    return {
      values: {
        offered: error.methods.join(", "),
      },
    };
  }),
  derived(BackendNameUnknownError, NAME_UNKNOWN_ADVICE, (error) => {
    return {
      values: {
        fix: LISTED_BY[error.kind],
      },
    };
  }),
];
