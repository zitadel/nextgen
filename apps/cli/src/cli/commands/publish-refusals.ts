import { type Refusal, refusalError } from "@/cli/core/refusal";
import {
  PublishConfigInvalidError,
  PublishConnectionSecretLiteralError,
  PublishConnectionVariableKindError,
  PublishConnectionVariableMissingError,
  PublishConnectionVariableSharedError,
  type Publisher,
} from "@/lib/publish";

/** How a configuration with errors is refused. */
const CONFIG_INVALID_REFUSAL = {
  message: "{message}",
  hint: "Fix the files named above and rerun; no changes were made.",
} as const satisfies Refusal;

/** How a connection that holds its secret itself is refused. */
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
  code: "E_CREDENTIAL_MISSING",
  message: "{message}",
  hint: "Publish it with the command below, then deploy again.",
  next: ["{set}"],
} as const satisfies Refusal;

/** How a connection that names a variable of the wrong kind is refused. */
const VARIABLE_KIND_REFUSAL = {
  message: "{message}",
  hint: "{hint}",
  next: ["{set}"],
} as const satisfies Refusal;

/**
 * Prepares what a deploy or a preview publishes, refusing a configuration that
 * cannot be published and saying how to fix it.
 *
 * @param publisher - The publisher.
 * @param input - What to prepare.
 * @returns What was prepared.
 * @throws {@link ZitadelError} The refusal for the condition publishing stopped on; an
 *   error nobody anticipated is thrown as it was.
 */
export async function prepareOrRefuse(
  publisher: Publisher,
  input: Parameters<Publisher["prepare"]>[0],
): ReturnType<Publisher["prepare"]> {
  try {
    return await publisher.prepare(input);
  } catch (error) {
    if (error instanceof PublishConnectionSecretLiteralError) {
      throw refusalError(SECRET_LITERAL_REFUSAL, {
        ...error,
        message: error.message,
      });
    }
    if (error instanceof PublishConnectionVariableSharedError) {
      throw refusalError(VARIABLE_SHARED_REFUSAL, {
        ...error,
        message: error.message,
      });
    }
    if (error instanceof PublishConnectionVariableMissingError) {
      throw refusalError(
        VARIABLE_MISSING_REFUSAL,
        {
          ...error,
          message: error.message,
        },
        {
          set: {
            id: "variable:set",
            args: {
              name: error.variable,
            },
            flags: {
              secret: error.secret,
              preview: input.mode === "preview",
            },
          },
        },
      );
    }
    if (error instanceof PublishConnectionVariableKindError) {
      throw refusalError(
        VARIABLE_KIND_REFUSAL,
        {
          ...error,
          message: error.message,
          hint: error.secret
            ? "The client secret must be a secret variable: publish it with the command below."
            : "The client id must be a plain variable the engine can read back: publish it with the command below, without --secret.",
        },
        {
          set: {
            id: "variable:set",
            args: {
              name: error.variable,
            },
            flags: {
              secret: error.secret,
              preview: input.mode === "preview",
            },
          },
        },
      );
    }
    if (error instanceof PublishConfigInvalidError) {
      throw refusalError(CONFIG_INVALID_REFUSAL, {
        ...error,
        message: error.message,
      });
    }
    throw error;
  }
}
