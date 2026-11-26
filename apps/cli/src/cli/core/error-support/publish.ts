import {
  PublishAssetLookupFailedError,
  PublishAssetTargetUnsafeError,
  PublishConfigInvalidError,
  PublishConnectionSecretLiteralError,
  PublishConnectionVariableKindError,
  PublishConnectionVariableMissingError,
  PublishConnectionVariableSharedError,
  PublishReleaseBodyInvalidError,
} from "@/lib/publish";

import type { Refusal } from "@/cli/core/refusal";
import { type Derived, derived, type Wording } from "./wording";

/** How a configuration with errors is refused. */
const CONFIG_INVALID_REFUSAL = {
  message: "{message}",
  hint: "Fix the files named above and rerun; no changes were made.{newer}",
  details: {
    issues: "{issues}",
  },
} as const satisfies Refusal;

/** How a release body the API does not take is refused. */
const RELEASE_BODY_INVALID_REFUSAL = {
  message: "{message}",
  details: {
    issues: "{issues}",
  },
} as const satisfies Refusal;

/** How a probed asset whose host resolves to an address that is not public is refused. */
const ASSET_TARGET_UNSAFE_REFUSAL = {
  message: "{message}",
  details: {
    original: "{original}",
  },
} as const satisfies Refusal;

/** How a probed asset whose host cannot be resolved is refused. */
const ASSET_LOOKUP_FAILED_REFUSAL = {
  message: "{message}",
  details: {
    original: "{original}",
  },
} as const satisfies Refusal;

/** What the refusal of a configuration adds when a finding refuses a key a newer server may have added. */
const NEWER_SERVER_KEY = " A key a newer Zitadel server added needs a CLI as new as the server.";

/** How a connection that holds its client secret itself is refused. */
const SECRET_LITERAL_REFUSAL = {
  message: "{message}",
  hint: 'Publish a secret with the command below and reference it as "${{ NAME }}".{newer}',
  next: [
    {
      id: "variable:set",
      args: {
        name: "NAME",
      },
      flags: {
        secret: true,
      },
    },
  ],
  details: {
    issues: "{issues}",
  },
} as const satisfies Refusal;

/** How a connection whose client id and secret name one variable is refused. */
const VARIABLE_SHARED_REFUSAL = {
  message: "{message}",
  hint: "Give each its own variable: a plain one for the client id, a secret one for the client secret.",
} as const satisfies Refusal;

/** How a connection that names a variable the project does not have is refused. */
const VARIABLE_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Publish it with the command below, then deploy again.",
  next: ["{set}"],
  details: {
    variable: "{variable}",
    field: "{field}",
    file: "{file}",
  },
} as const satisfies Refusal;

/** How a connection that names a variable of the wrong kind is refused. */
const VARIABLE_KIND_REFUSAL = {
  message: "{message}",
  hint: "{fix}",
  next: ["{set}"],
  details: {
    variable: "{variable}",
    field: "{field}",
    file: "{file}",
    secret: "{held}",
  },
} as const satisfies Refusal;

/**
 * The words a configuration's refusal adds for its findings.
 *
 * @param refusedKey - Whether a finding refuses a key a newer server may have added.
 * @returns What the refusal's placeholders are filled with.
 */
function newerOf(refusedKey: boolean): Derived {
  return {
    values: {
      newer: refusedKey ? NEWER_SERVER_KEY : "",
    },
  };
}

/** How the errors of `@/lib/publish` are worded, most specific class first. */
export const PUBLISH_WORDINGS: readonly Wording[] = [
  derived(PublishConfigInvalidError, CONFIG_INVALID_REFUSAL, (error) => {
    return newerOf(error.refusedKey);
  }),
  [PublishReleaseBodyInvalidError, RELEASE_BODY_INVALID_REFUSAL],
  derived(PublishConnectionSecretLiteralError, SECRET_LITERAL_REFUSAL, (error) => {
    return newerOf(error.refusedKey);
  }),
  [PublishConnectionVariableSharedError, VARIABLE_SHARED_REFUSAL],
  derived(PublishConnectionVariableMissingError, VARIABLE_MISSING_REFUSAL, (error) => {
    return {
      next: {
        set: {
          id: "variable:set",
          args: {
            name: error.variable,
          },
          flags: {
            secret: error.secret,
            preview: error.preview,
          },
        },
      },
    };
  }),
  derived(PublishConnectionVariableKindError, VARIABLE_KIND_REFUSAL, (error) => {
    return {
      values: {
        // The connection names a variable of the other kind than the one it
        // needs, so the variable is a secret exactly when it must not be.
        held: !error.secret,
        fix: error.secret
          ? "The client secret must be a secret variable: publish it with the command below."
          : "The client id must be a plain variable the engine can read back: publish it with the command below, without --secret.",
      },
      next: {
        set: {
          id: "variable:set",
          args: {
            name: error.variable,
          },
          flags: {
            secret: error.secret,
            preview: error.preview,
          },
        },
      },
    };
  }),
  [PublishAssetTargetUnsafeError, ASSET_TARGET_UNSAFE_REFUSAL],
  [PublishAssetLookupFailedError, ASSET_LOOKUP_FAILED_REFUSAL],
];
