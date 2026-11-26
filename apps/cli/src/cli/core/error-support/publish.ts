import {
  PublishConfigInvalidError,
  PublishConnectionSecretLiteralError,
  PublishConnectionVariableKindError,
  PublishConnectionVariableMissingError,
  PublishConnectionVariableSharedError,
} from "@/lib/publish";

import type { Refusal } from "@/cli/core/refusal";
import { derived, type Wording } from "./wording";

/** How a configuration with errors is refused. */
const CONFIG_INVALID_REFUSAL = {
  message: "{message}",
  hint: "Fix the files named above and rerun; no changes were made.",
} as const satisfies Refusal;

/** How a connection that holds its client secret itself is refused. */
const SECRET_LITERAL_REFUSAL = {
  message: "{message}",
  hint: 'Publish a secret with the command below and reference it as "${{ NAME }}".',
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
} as const satisfies Refusal;

/** How a connection that names a variable of the wrong kind is refused. */
const VARIABLE_KIND_REFUSAL = {
  message: "{message}",
  hint: "{fix}",
  next: ["{set}"],
} as const satisfies Refusal;

/**
 * How the errors of `@/lib/publish` are worded, most specific class first. The
 * asset probe's own errors become warnings inside it, so they have none.
 */
export const PUBLISH_WORDINGS: readonly Wording[] = [
  [PublishConfigInvalidError, CONFIG_INVALID_REFUSAL],
  [PublishConnectionSecretLiteralError, SECRET_LITERAL_REFUSAL],
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
];
