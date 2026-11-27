import {
  PublishApplicationSecretMissingError,
  PublishApplicationSecretPlainError,
  PublishConnectionSecretLiteralError,
  PublishConnectionVariableKindError,
  PublishConnectionVariableMissingError,
} from "@/lib/publish";

import { type Advice, derived, type Wording } from "./wording";

/** What the advice on a connection adds when a finding refuses a key a newer server may have added. */
const NEWER_SERVER_KEY = " A key a newer Zitadel server added needs a CLI as new as the server.";

/** How a connection that holds its client secret itself is refused. */
const SECRET_LITERAL_ADVICE = {
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
} as const satisfies Advice;

/** How a connection that names a variable the project does not have is refused. */
const VARIABLE_MISSING_ADVICE = {
  hint: "Publish it with the command below, then deploy again.",
  next: ["{set}"],
  details: {
    variable: "{variable}",
    field: "{field}",
    file: "{file}",
  },
} as const satisfies Advice;

/** How a connection that names a variable of the wrong kind is refused. */
const VARIABLE_KIND_ADVICE = {
  hint: "{fix}",
  next: ["{set}"],
  details: {
    variable: "{variable}",
    field: "{field}",
    file: "{file}",
    secret: "{held}",
  },
} as const satisfies Advice;

/** How a declared application that names a secret the project does not hold is refused. */
const APPLICATION_SECRET_MISSING_ADVICE = {
  hint: "Publish it as a secret with the command below, then deploy again.",
  next: ["{set}"],
  details: {
    variable: "{variable}",
    client: "{client}",
    file: "{file}",
  },
} as const satisfies Advice;

/** How a declared application that names a plain variable as its secret is refused. */
const APPLICATION_SECRET_PLAIN_ADVICE = {
  hint: "A client secret must be a secret variable: publish it with the command below.",
  next: ["{set}"],
  details: {
    variable: "{variable}",
    client: "{client}",
    file: "{file}",
    secret: "{held}",
  },
} as const satisfies Advice;

/** How the errors of `@/lib/publish` are advised on, each for exactly its class. */
export const PUBLISH_WORDINGS: readonly Wording[] = [
  derived(PublishApplicationSecretMissingError, APPLICATION_SECRET_MISSING_ADVICE, (error) => {
    return {
      values: {
        variable: error.use.variable,
        client: error.use.client,
        file: error.use.file,
      },
      next: {
        set: {
          id: "variable:set",
          args: {
            name: error.use.variable,
          },
          flags: {
            secret: true,
            preview: error.use.preview,
          },
        },
      },
    };
  }),
  derived(PublishApplicationSecretPlainError, APPLICATION_SECRET_PLAIN_ADVICE, (error) => {
    return {
      values: {
        variable: error.use.variable,
        client: error.use.client,
        file: error.use.file,
        held: false,
      },
      next: {
        set: {
          id: "variable:set",
          args: {
            name: error.use.variable,
          },
          flags: {
            secret: true,
            preview: error.use.preview,
          },
        },
      },
    };
  }),
  derived(PublishConnectionSecretLiteralError, SECRET_LITERAL_ADVICE, (error) => {
    return {
      values: {
        newer: error.refusedKey ? NEWER_SERVER_KEY : "",
      },
    };
  }),
  derived(PublishConnectionVariableMissingError, VARIABLE_MISSING_ADVICE, (error) => {
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
  derived(PublishConnectionVariableKindError, VARIABLE_KIND_ADVICE, (error) => {
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
];
