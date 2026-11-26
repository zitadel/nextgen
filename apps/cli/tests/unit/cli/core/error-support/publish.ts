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

import type { Row } from "./row";

/** The connection file every connection row is about. */
const CONNECTION = "zitadel/connections/acme.json";

/** A finding the configuration check refuses. */
const FLOW_ISSUES = [
  {
    rule: "flow/unknown-step",
    path: "zitadel/flows/login.json",
    message: "step otp is not defined",
  },
] as const;

/** A connection whose client secret is written into its file. */
const LITERAL_ISSUES = [
  {
    rule: "connection/literal-secret",
    path: CONNECTION,
    message: "client_secret is written in the file; reference a secret variable instead",
  },
] as const;

/** A user schema key the CLI's meta-schema does not allow. */
const KEY_ISSUES = [
  {
    rule: "contract/schema",
    path: ".zitadel/schemas/customer.json",
    message: "nickname is not an allowed key",
  },
] as const;

/** The message a configuration with a refused key is refused with. */
const KEY_MESSAGE =
  "Configuration validation failed (1 issue):\n  - .zitadel/schemas/customer.json: nickname is not an allowed key";

/** A field of the release body the API does not take. */
const BODY_ISSUES = [
  {
    code: "invalid_type",
    expected: "string",
    path: ["flows", "login", "name"],
    message: "Invalid input: expected string, received number",
  },
] as const;

/** The message the release-body check refuses with. */
const BODY_MESSAGE =
  "The release body does not match what the API takes, so nothing was sent:\n  - bundle.flows.login.name Invalid input: expected string, received number";

/** What the resolver reports of a host that does not exist. */
const ENOTFOUND_MESSAGE = "getaddrinfo ENOTFOUND assets.acme.test";

/** What the probe refuses a host that resolves to a private address with. */
const UNSAFE_MESSAGE = "asset target assets.acme.test resolves to a non-public address";

/** The errors of `@/lib/publish`, each with what main showed for it. */
export const PUBLISH_ROWS: readonly Row[] = [
  {
    case: "a configuration with an error",
    error: new PublishConfigInvalidError(
      "Configuration validation failed (1 issue):\n  - zitadel/flows/login.json: step otp is not defined",
      FLOW_ISSUES,
      false,
    ),
    main: "lib/publish/steps/validate.ts:119",
    expected: {
      code: "E_VALIDATION",
      message:
        "Configuration validation failed (1 issue):\n  - zitadel/flows/login.json: step otp is not defined",
      hint: "Fix the files named above and rerun; no changes were made.",
      details: { issues: FLOW_ISSUES },
      exitCode: 3,
    },
  },
  {
    case: "a configuration with a key a newer server added",
    error: new PublishConfigInvalidError(KEY_MESSAGE, KEY_ISSUES, true),
    main: "lib/publish/steps/validate.ts:119",
    expected: {
      code: "E_VALIDATION",
      message: KEY_MESSAGE,
      hint: "Fix the files named above and rerun; no changes were made. A key a newer Zitadel server added needs a CLI as new as the server.",
      details: { issues: KEY_ISSUES },
      exitCode: 3,
    },
  },
  {
    error: new PublishReleaseBodyInvalidError(BODY_MESSAGE, BODY_ISSUES),
    main: "lib/publish/publisher.ts:472",
    expected: {
      code: "E_VALIDATION",
      message: BODY_MESSAGE,
      details: { issues: BODY_ISSUES },
      exitCode: 3,
    },
  },
  {
    error: new PublishConnectionSecretLiteralError(
      `Configuration validation failed (1 issue):\n  - ${CONNECTION}: client_secret is written in the file; reference a secret variable instead`,
      LITERAL_ISSUES,
      false,
    ),
    main: "lib/publish/steps/validate.ts:119",
    expected: {
      code: "E_VALIDATION",
      message: `Configuration validation failed (1 issue):\n  - ${CONNECTION}: client_secret is written in the file; reference a secret variable instead`,
      hint: 'Publish a secret with the command below and reference it as "${{ NAME }}".',
      next: [{ id: "variable:set", args: { name: "NAME" }, flags: { secret: true } }],
      details: { issues: LITERAL_ISSUES },
      exitCode: 3,
    },
  },
  {
    error: new PublishConnectionVariableSharedError(
      `${CONNECTION}: client_id and client_secret both name the variable ACME_CLIENT`,
      "ACME_CLIENT",
      CONNECTION,
    ),
    main: "lib/publish/steps/idp-checks.ts:118",
    expected: {
      code: "E_VALIDATION",
      message: `${CONNECTION}: client_id and client_secret both name the variable ACME_CLIENT`,
      hint: "Give each its own variable: a plain one for the client id, a secret one for the client secret.",
      details: { variable: "ACME_CLIENT", file: CONNECTION },
      exitCode: 3,
    },
  },
  {
    case: "a client secret's variable missing on a deploy",
    error: new PublishConnectionVariableMissingError(
      `${CONNECTION}: client_secret names the variable ACME_SECRET, which the project does not have`,
      {
        variable: "ACME_SECRET",
        field: "client_secret",
        file: CONNECTION,
        secret: true,
        preview: false,
      },
    ),
    main: "lib/publish/steps/idp-checks.ts:138",
    expected: {
      code: "E_CREDENTIAL_MISSING",
      message: `${CONNECTION}: client_secret names the variable ACME_SECRET, which the project does not have`,
      hint: "Publish it with the command below, then deploy again.",
      next: [
        {
          id: "variable:set",
          args: { name: "ACME_SECRET" },
          flags: { secret: true, preview: false },
        },
      ],
      details: { variable: "ACME_SECRET", field: "client_secret", file: CONNECTION },
      exitCode: 3,
    },
  },
  {
    case: "a client id's variable missing on a preview",
    error: new PublishConnectionVariableMissingError(
      `${CONNECTION}: client_id names the variable ACME_ID, which the project does not have`,
      {
        variable: "ACME_ID",
        field: "client_id",
        file: CONNECTION,
        secret: false,
        preview: true,
      },
    ),
    main: "lib/publish/steps/idp-checks.ts:138",
    expected: {
      code: "E_CREDENTIAL_MISSING",
      message: `${CONNECTION}: client_id names the variable ACME_ID, which the project does not have`,
      hint: "Publish it with the command below, then deploy again.",
      next: [
        {
          id: "variable:set",
          args: { name: "ACME_ID" },
          flags: { secret: false, preview: true },
        },
      ],
      details: { variable: "ACME_ID", field: "client_id", file: CONNECTION },
      exitCode: 3,
    },
  },
  {
    case: "a client secret named by a plain variable",
    error: new PublishConnectionVariableKindError(
      `${CONNECTION}: client_secret names the variable ACME_SECRET, which is not a secret`,
      {
        variable: "ACME_SECRET",
        field: "client_secret",
        file: CONNECTION,
        secret: true,
        preview: false,
      },
    ),
    main: "lib/publish/steps/idp-checks.ts:153",
    expected: {
      code: "E_VALIDATION",
      message: `${CONNECTION}: client_secret names the variable ACME_SECRET, which is not a secret`,
      hint: "The client secret must be a secret variable: publish it with the command below.",
      next: [
        {
          id: "variable:set",
          args: { name: "ACME_SECRET" },
          flags: { secret: true, preview: false },
        },
      ],
      details: {
        variable: "ACME_SECRET",
        field: "client_secret",
        file: CONNECTION,
        secret: false,
      },
      exitCode: 3,
    },
  },
  {
    case: "a client id named by a secret variable",
    error: new PublishConnectionVariableKindError(
      `${CONNECTION}: client_id names the variable ACME_ID, which is a secret`,
      {
        variable: "ACME_ID",
        field: "client_id",
        file: CONNECTION,
        secret: false,
        preview: true,
      },
    ),
    main: "lib/publish/steps/idp-checks.ts:153",
    expected: {
      code: "E_VALIDATION",
      message: `${CONNECTION}: client_id names the variable ACME_ID, which is a secret`,
      hint: "The client id must be a plain variable the engine can read back: publish it with the command below, without --secret.",
      next: [
        {
          id: "variable:set",
          args: { name: "ACME_ID" },
          flags: { secret: false, preview: true },
        },
      ],
      details: {
        variable: "ACME_ID",
        field: "client_id",
        file: CONNECTION,
        secret: true,
      },
      exitCode: 3,
    },
  },
  {
    error: new PublishAssetTargetUnsafeError(UNSAFE_MESSAGE),
    main: "lib/publish/steps/asset-probe.ts:379",
    expected: {
      code: "E_VALIDATION",
      message: UNSAFE_MESSAGE,
      details: {
        original: {
          name: "Error",
          message: UNSAFE_MESSAGE,
          code: "ERR_ZITADEL_UNSAFE_ASSET_TARGET",
        },
      },
      exitCode: 3,
    },
    deviation: {
      reason:
        "main's internal ERR_ZITADEL_UNSAFE_ASSET_TARGET error no longer exists; the typed class stands in and reports its own code",
      shown: {
        details: {
          original: {
            name: "PublishAssetTargetUnsafeError",
            message: UNSAFE_MESSAGE,
          },
        },
      },
    },
  },
  {
    error: new PublishAssetLookupFailedError(
      "asset target assets.acme.test cannot be resolved",
      Object.assign(new Error(ENOTFOUND_MESSAGE), {
        code: "ENOTFOUND",
        syscall: "getaddrinfo",
        hostname: "assets.acme.test",
      }),
    ),
    main: "lib/publish/steps/asset-probe.ts:331",
    expected: {
      code: "E_VALIDATION",
      message: ENOTFOUND_MESSAGE,
      details: {
        original: { name: "Error", message: ENOTFOUND_MESSAGE, code: "ENOTFOUND" },
      },
      exitCode: 3,
    },
    deviation: {
      reason:
        "a host that cannot be resolved is a network failure worth retrying, not invalid input, and the message names the asset host",
      shown: {
        code: "E_NETWORK",
        message: "asset target assets.acme.test cannot be resolved",
        exitCode: 4,
      },
    },
  },
];
