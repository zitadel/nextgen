import {
  type FlowIssue,
  type FlowMethodUse,
  PasswordPolicy,
  SignupPolicy,
  stepName,
  UserSchema,
  ZitadelConfigBrandingDuplicatedError,
  ZitadelConfigClientIdMismatchError,
  ZitadelConfigConnectionDuplicatedError,
  ZitadelConfigConnectionExistsError,
  ZitadelConfigConnectionFileTakenError,
  ZitadelConfigConnectionIssuerClashError,
  ZitadelConfigConnectionNotOidcError,
  ZitadelConfigConnectionProviderMismatchError,
  ZitadelConfigCredentialsDoubledError,
  ZitadelConfigDirectoryInTheWayError,
  ZitadelConfigEditLockoutError,
  ZitadelConfigError,
  ZitadelConfigFileExistsError,
  ZitadelConfigFileUnreadableError,
  ZitadelConfigFilesBrokenError,
  ZitadelConfigFlowBrokenError,
  ZitadelConfigFlowMethodInUseError,
  ZitadelConfigFlowMissingError,
  ZitadelConfigFlowUncheckedError,
  ZitadelConfigHandleClashError,
  ZitadelConfigHandleInvalidError,
  ZitadelConfigIdentifierMissingError,
  ZitadelConfigInternalError,
  ZitadelConfigNothingToDeployError,
  ZitadelConfigOutcomeActionClashError,
  ZitadelConfigPasswordPolicyInvalidError,
  ZitadelConfigPathBlockedError,
  ZitadelConfigPathOutsideError,
  ZitadelConfigPathUnreadableError,
  ZitadelConfigProviderFileTakenError,
  ZitadelConfigProviderUnknownError,
  ZitadelConfigReferenceBrokenError,
  ZitadelConfigReferenceMissingError,
  ZitadelConfigReferenceOutsideError,
  ZitadelConfigReferenceUnreadableError,
  ZitadelConfigRegionUneditableError,
  ZitadelConfigRenameActionClashError,
  ZitadelConfigRenameRouteLossError,
  ZitadelConfigResourceClashError,
  ZitadelConfigResourceMissingError,
  ZitadelConfigSchemaAmbiguousError,
  ZitadelConfigSchemaExternalError,
  ZitadelConfigSchemaMissingError,
  ZitadelConfigSettingUnusableError,
  ZitadelConfigSignupPolicyInvalidError,
  ZitadelConfigSlugDuplicatedError,
  ZitadelConfigVariableSharedError,
} from "@/lib/zitadel";
import { aUserSchema } from "@tests/helpers/config";

import type { Row } from "./row";

/** The user schema most rows name. */
const SCHEMA_PATH = ".zitadel/schemas/user.json";

/** A second user schema, for the rows that need more than one. */
const ADMIN_SCHEMA_PATH = ".zitadel/schemas/admin.json";

/** The login flow the flow rows name. */
const FLOW_PATH = ".zitadel/flows/login.json";

/** The Google connection's file. */
const GOOGLE_PATH = ".zitadel/idps/google.json";

/** A connection of the developer's own. */
const ACME_PATH = ".zitadel/idps/acme.json";

/** A file whose `$file` references the rows read. */
const BRANDING_PATH = ".zitadel/branding/default.json";

/** A `$file` reference as written. */
const REF = "./logo.svg";

/** The hint main gave every failure to read a file. */
const UNREADABLE_HINT = "Check that the file is readable, then run the command again.";

/** The hint main gave every unreadable `$file` reference. */
const REFERENCE_HINT = "Create the referenced file or fix the path.";

/** The hint main gave a file already there. */
const FILE_EXISTS_HINT =
  "Move or rename the file that is already there, then run the command again.";

/** The user schema most rows name. */
const USER_SCHEMA = UserSchema.create({ path: SCHEMA_PATH, body: aUserSchema() });

/** A second user schema. */
const ADMIN_SCHEMA = UserSchema.create({ path: ADMIN_SCHEMA_PATH, body: aUserSchema() });

/** The flow issue the flow rows report. */
const FLOW_ISSUE: FlowIssue = {
  path: FLOW_PATH,
  issue: {
    severity: "error",
    rule: "schema/fields-resolve",
    message: 'step "password" collects a field the schema does not have',
    step: "password",
  },
};

/** The flow issue as main reported it in `details.issues`. */
const FLOW_ISSUE_DETAIL = {
  path: FLOW_PATH,
  rule: "schema/fields-resolve",
  message: 'step "password" collects a field the schema does not have',
  step: "password",
};

/** The step that still uses the method being turned off. */
const FLOW_USE: FlowMethodUse = {
  path: FLOW_PATH,
  step: stepName("password"),
  uses: "collects password",
  keeps: [],
  entryFor: ["login"],
  targetedBy: [{ step: stepName("start"), transition: "next" }],
  staying: [{ step: stepName("start"), transition: "next" }],
};

/** The message a refused disable of password states for {@link FLOW_USE}. */
const METHOD_IN_USE_MESSAGE = [
  `Disabling password in ${SCHEMA_PATH} would break a login flow that still uses it:`,
  `  - ${FLOW_PATH}: step "password" collects password\n    Left with no field or sign-in method. Entry step of purposes.login. Targeted by start.next.`,
].join("\n");

/** The message a flow that cannot be checked states. */
const UNCHECKED_MESSAGE = [
  "A login flow has errors, so it cannot be checked against the changed schema:",
  `  - ${FLOW_PATH}: ${FLOW_ISSUE.issue.message}`,
].join("\n");

/** The message an edit that breaks a flow states. */
const BROKEN_MESSAGE = [
  "A login flow would stop validating after this change:",
  `  - ${FLOW_PATH}: ${FLOW_ISSUE.issue.message}`,
].join("\n");

/** The problems a broken configuration file reports. */
const PROBLEMS = [
  { path: SCHEMA_PATH, problem: "kind is required" },
  { path: SCHEMA_PATH, problem: "type is required" },
];

/** The errors of `@/lib/zitadel`, each with what main showed for it. */
export const ZITADEL_ROWS: readonly Row[] = [
  {
    error: new ZitadelConfigError("A release pins at most 50 resources, but .zitadel/ holds 51"),
    main: "lib/zitadel/config.ts:463",
    expected: {
      code: "E_VALIDATION",
      message: "A release pins at most 50 resources, but .zitadel/ holds 51",
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigFlowMethodInUseError(METHOD_IN_USE_MESSAGE, {
      file: SCHEMA_PATH,
      method: "password",
      issues: [FLOW_ISSUE],
      uses: [FLOW_USE],
    }),
    main: "lib/zitadel/rules/flows.ts:167",
    expected: {
      code: "E_VALIDATION",
      message: METHOD_IN_USE_MESSAGE,
      hint: "Edit those steps first; login flows are not edited for you. From each step, remove its x-auth-methods#password field. Delete a step left with no field or sign-in method: retarget the transitions listed for it, and point the purposes key it is the entry step of at another step. `zitadel deploy --dry-run` checks the edited flow; then run the command again.",
      details: {
        file: SCHEMA_PATH,
        issues: [FLOW_ISSUE_DETAIL],
        steps: [
          {
            path: FLOW_PATH,
            step: "password",
            keeps: [],
            entry_for: ["login"],
            targeted_by: [{ step: "start", transition: "next" }],
          },
        ],
      },
      next: [{ id: "deploy", flags: { dryRun: true } }],
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigFlowBrokenError(BROKEN_MESSAGE, {
      file: SCHEMA_PATH,
      issues: [FLOW_ISSUE],
    }),
    main: "lib/zitadel/rules/flows.ts:117",
    expected: {
      code: "E_VALIDATION",
      message: BROKEN_MESSAGE,
      hint: "Fix the steps named above, then run the command again.",
      details: { file: SCHEMA_PATH, issues: [FLOW_ISSUE_DETAIL] },
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigFlowUncheckedError(UNCHECKED_MESSAGE, {
      file: SCHEMA_PATH,
      issues: [FLOW_ISSUE],
    }),
    main: "lib/zitadel/rules/flows.ts:207",
    expected: {
      code: "E_VALIDATION",
      message: UNCHECKED_MESSAGE,
      hint: "Fix those errors first (`zitadel deploy --dry-run` reports them too), then run the command again.",
      details: { file: SCHEMA_PATH, issues: [FLOW_ISSUE_DETAIL] },
      next: [{ id: "deploy", flags: { dryRun: true } }],
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigFilesBrokenError(PROBLEMS),
    main: "lib/zitadel/config.ts:632",
    expected: {
      code: "E_VALIDATION",
      message: [
        "1 configuration file is not valid:",
        `  - ${SCHEMA_PATH}: kind is required`,
        `  - ${SCHEMA_PATH}: type is required`,
      ].join("\n"),
      hint: "Fix the files named above, then run the command again; nothing was changed.",
      details: { problems: PROBLEMS },
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigNothingToDeployError(),
    main: "lib/zitadel/config.ts:458",
    expected: {
      code: "E_VALIDATION",
      message: "There is nothing in .zitadel/ to deploy",
      hint: "Add a schema, flow, policy or branding under .zitadel/, or run `zitadel setup` to scaffold one.",
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigClientIdMismatchError(ACME_PATH, "stored-id", "supplied-id"),
    main: "lib/zitadel/resources/connections/connection.ts:507",
    expected: {
      code: "E_VALIDATION",
      message: `${ACME_PATH} already uses client id stored-id, not supplied-id`,
      hint: "Edit the connection file to change its client id, or run the command without one to reuse it.",
      details: {
        file: ACME_PATH,
        stored_client_id: "stored-id",
        supplied_client_id: "supplied-id",
      },
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigSettingUnusableError(
      ACME_PATH,
      "acme",
      "an issuer",
      "it must use https",
    ),
    main: "lib/zitadel/resources/connections/connection.ts:562",
    expected: {
      code: "E_VALIDATION",
      message: `${ACME_PATH} holds an issuer that cannot be used: it must use https`,
      hint: "Fix it in that file, or choose another slug.",
      details: { file: ACME_PATH, slug: "acme" },
      exitCode: 3,
    },
  },
  {
    case: "a file the OS refused with an errno",
    error: new ZitadelConfigPathUnreadableError(SCHEMA_PATH, "EIO", new Error("EIO")),
    main: "lib/zitadel/storage/backend/store.ts:424",
    expected: {
      code: "E_VALIDATION",
      message: `${SCHEMA_PATH} cannot be read (EIO)`,
      hint: UNREADABLE_HINT,
      details: { file: SCHEMA_PATH, code: "EIO" },
      exitCode: 3,
    },
  },
  {
    case: "a file that failed without an errno",
    error: new ZitadelConfigPathUnreadableError(SCHEMA_PATH, undefined, new Error("boom")),
    main: "lib/zitadel/storage/backend/store.ts:424",
    expected: {
      code: "E_VALIDATION",
      message: `${SCHEMA_PATH} cannot be read`,
      hint: UNREADABLE_HINT,
      details: { file: SCHEMA_PATH },
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigResourceClashError(`${ACME_PATH} clashes with another connection`),
    main: "lib/zitadel/errors.ts:156",
    expected: {
      code: "E_CONFLICT",
      message: `${ACME_PATH} clashes with another connection`,
      exitCode: 5,
    },
  },
  {
    error: new ZitadelConfigConnectionNotOidcError(ACME_PATH, "acme"),
    main: "lib/zitadel/resources/connections/connection.ts:518",
    expected: {
      code: "E_CONFLICT",
      message: `${ACME_PATH} is already named acme and is not an OIDC connection`,
      hint: "Fix the file, or choose another slug, then run the command again.",
      details: { file: ACME_PATH, slug: "acme" },
      exitCode: 5,
    },
  },
  {
    case: "a connection to another issuer",
    error: new ZitadelConfigConnectionIssuerClashError(
      ACME_PATH,
      "acme",
      "https://new.example.com",
      "https://old.example.com",
    ),
    main: "lib/zitadel/resources/connections/collection.ts:685",
    expected: {
      code: "E_CONFLICT",
      message: `${ACME_PATH} is already named acme and connects to https://old.example.com, not https://new.example.com`,
      hint: "An applied connection keeps its issuer, and the server compares it exactly, so even a trailing slash names another provider. Choose another slug for this connection, then move the schemas and flows that name the old one to it.",
      details: {
        file: ACME_PATH,
        slug: "acme",
        issuer: "https://new.example.com",
        existing_issuer: "https://old.example.com",
      },
      exitCode: 5,
    },
  },
  {
    case: "a connection with no issuer",
    error: new ZitadelConfigConnectionIssuerClashError(
      ACME_PATH,
      "acme",
      "https://new.example.com",
      undefined,
    ),
    main: "lib/zitadel/resources/connections/collection.ts:685",
    expected: {
      code: "E_CONFLICT",
      message: `${ACME_PATH} is already named acme and is not an OIDC connection to https://new.example.com`,
      hint: "An applied connection keeps its issuer, and the server compares it exactly, so even a trailing slash names another provider. Choose another slug for this connection, then move the schemas and flows that name the old one to it.",
      details: {
        file: ACME_PATH,
        slug: "acme",
        issuer: "https://new.example.com",
        existing_issuer: null,
      },
      exitCode: 5,
    },
  },
  {
    error: new ZitadelConfigProviderFileTakenError(GOOGLE_PATH, "google", "my-google"),
    main: "lib/zitadel/resources/connections/collection.ts:658",
    expected: {
      code: "E_CONFLICT",
      message: `${GOOGLE_PATH} already exists and is not the google connection`,
      hint: "Rename or remove that file, then run the command again.",
      details: { file: GOOGLE_PATH, slug: "my-google" },
      exitCode: 5,
    },
  },
  {
    error: new ZitadelConfigConnectionFileTakenError(ACME_PATH, "acme", "corp"),
    main: "lib/zitadel/resources/connections/collection.ts:658",
    expected: {
      code: "E_CONFLICT",
      message: `${ACME_PATH} already exists and is not the acme connection`,
      hint: "Rename or remove that file, or choose another slug, then run the command again.",
      details: { file: ACME_PATH, slug: "corp" },
      exitCode: 5,
    },
  },
  {
    error: new ZitadelConfigResourceMissingError("No connection is named acme"),
    main: "lib/zitadel/errors.ts:166",
    expected: {
      code: "E_NOT_FOUND",
      message: "No connection is named acme",
      exitCode: 4,
    },
  },
  {
    case: "a project with no user schema",
    error: new ZitadelConfigSchemaMissingError(undefined, []),
    main: "lib/zitadel/resources/schemas/collection.ts:153",
    expected: {
      code: "E_NOT_FOUND",
      message: "There is no user schema under .zitadel/schemas",
      details: { requested: null, known: [] },
      exitCode: 4,
    },
  },
  {
    case: "a schema name nothing has",
    error: new ZitadelConfigSchemaMissingError("admin", [USER_SCHEMA]),
    main: "lib/zitadel/resources/schemas/collection.ts:168",
    expected: {
      code: "E_NOT_FOUND",
      message: "No user schema is named admin",
      details: { requested: "admin", known: ["user"] },
      exitCode: 4,
    },
  },
  {
    case: "several schemas and none named",
    error: new ZitadelConfigSchemaAmbiguousError(undefined, [ADMIN_SCHEMA, USER_SCHEMA]),
    main: "lib/zitadel/resources/schemas/collection.ts:157",
    expected: {
      code: "E_VALIDATION",
      message: "There is more than one user schema, and none was named",
      details: { requested: null, candidates: ["admin", "user"] },
      exitCode: 3,
    },
  },
  {
    case: "a name several schemas answer to",
    error: new ZitadelConfigSchemaAmbiguousError("human-user", [ADMIN_SCHEMA, USER_SCHEMA]),
    main: "lib/zitadel/resources/schemas/collection.ts:171",
    expected: {
      code: "E_VALIDATION",
      message: "More than one user schema is named human-user",
      details: { requested: "human-user", candidates: ["admin", "user"] },
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigEditLockoutError({
      path: SCHEMA_PATH,
      schema: "user",
      disabling: "password",
      usable: ["password"],
      alternatives: ["passkey"],
    }),
    main: "lib/zitadel/resources/schemas/collection.ts:220",
    expected: {
      code: "E_VALIDATION",
      message: `${SCHEMA_PATH} would have no way to sign in left`,
      details: { file: SCHEMA_PATH, usable: ["password"], alternatives: ["passkey"] },
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigFileExistsError(SCHEMA_PATH),
    main: "lib/zitadel/storage/backend/store.ts:227",
    expected: {
      code: "E_CONFLICT",
      message: `${SCHEMA_PATH} already exists`,
      hint: FILE_EXISTS_HINT,
      details: { file: SCHEMA_PATH },
      exitCode: 5,
    },
  },
  {
    error: new ZitadelConfigConnectionExistsError(GOOGLE_PATH, { kind: "catalog", id: "google" }),
    main: "lib/zitadel/config.ts:517",
    expected: {
      code: "E_CONFLICT",
      message: `${GOOGLE_PATH} already exists`,
      hint: "A connection file is yours to keep, so it is never replaced or removed. Remove it to scaffold a fresh one, or keep it and enable the provider to reuse it.",
      details: { file: GOOGLE_PATH },
      exitCode: 5,
    },
  },
  {
    case: "a file the OS refused with EACCES",
    error: new ZitadelConfigFileUnreadableError(SCHEMA_PATH, "EACCES", new Error("EACCES")),
    main: "lib/zitadel/storage/backend/store.ts:424",
    expected: {
      code: "E_AUTH",
      message: `${SCHEMA_PATH} cannot be read (EACCES)`,
      hint: UNREADABLE_HINT,
      details: { file: SCHEMA_PATH, code: "EACCES" },
      exitCode: 1,
    },
  },
  {
    case: "a file the OS refused with EPERM",
    error: new ZitadelConfigFileUnreadableError(SCHEMA_PATH, "EPERM", new Error("EPERM")),
    main: "lib/zitadel/storage/backend/store.ts:424",
    expected: {
      code: "E_AUTH",
      message: `${SCHEMA_PATH} cannot be read (EPERM)`,
      hint: UNREADABLE_HINT,
      details: { file: SCHEMA_PATH, code: "EPERM" },
      exitCode: 1,
    },
  },
  {
    error: new ZitadelConfigReferenceUnreadableError(
      BRANDING_PATH,
      REF,
      "EACCES",
      new Error("EACCES"),
    ),
    main: "lib/zitadel/storage/backend/store.ts:258",
    expected: {
      code: "E_AUTH",
      message: `$file ${JSON.stringify(REF)} cannot be read`,
      hint: REFERENCE_HINT,
      details: { file: BRANDING_PATH, ref: REF, code: "EACCES" },
      exitCode: 1,
    },
  },
  {
    error: new ZitadelConfigSchemaExternalError(SCHEMA_PATH),
    main: "lib/zitadel/resources/schemas/schema.ts:643",
    expected: {
      code: "E_VALIDATION",
      message: `${SCHEMA_PATH} points at an external schema`,
      hint: "Its sign-in methods live in the schema at its url, which the server fetches. Edit x-auth-methods there instead.",
      details: { file: SCHEMA_PATH },
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigInternalError("The default flow is not a JSON object"),
    main: "lib/zitadel/utils/json.ts:59",
    expected: {
      code: "E_VALIDATION",
      message: "The default flow is not a JSON object",
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigBrandingDuplicatedError(2),
    main: "lib/zitadel/config.ts:420",
    expected: {
      code: "E_VALIDATION",
      message: "A release carries at most one branding, but .zitadel/branding/ holds 2",
      hint: "A project has a single branding; keep one descriptor under .zitadel/branding/.",
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigPasswordPolicyInvalidError(PasswordPolicy.PATH),
    main: "lib/zitadel/config.ts:755",
    expected: {
      code: "E_VALIDATION",
      message: `${PasswordPolicy.PATH} is not a valid password policy`,
      hint: "Setup keeps an existing policy file and deploys it, so fix it against .zitadel/meta/policy.json or move it aside to start from an empty one.",
      details: { file: PasswordPolicy.PATH },
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigSignupPolicyInvalidError(SignupPolicy.PATH),
    main: "lib/zitadel/config.ts:780",
    expected: {
      code: "E_VALIDATION",
      message: `${SignupPolicy.PATH} is not a valid sign-up policy`,
      hint: "Setup keeps an existing policy file and deploys it, so fix it against .zitadel/meta/policy.json or move it aside to start from the default.",
      details: { file: SignupPolicy.PATH },
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigHandleInvalidError("../escape"),
    main: "lib/zitadel/errors.ts:133",
    expected: {
      code: "E_VALIDATION",
      message: '"../escape" cannot be the name of a file',
      hint: "A handle must be a single name, without slashes or dots that climb out of its directory.",
      details: { handle: "../escape" },
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigHandleClashError("default", [
      ".zitadel/branding/a.json",
      ".zitadel/branding/b.json",
    ]),
    main: "lib/zitadel/resources/collection.ts:241",
    expected: {
      code: "E_CONFLICT",
      message: ".zitadel/branding/a.json and .zitadel/branding/b.json both hold default",
      hint: "Remove or fix all but one of them, then run the command again.",
      details: {
        handle: "default",
        paths: [".zitadel/branding/a.json", ".zitadel/branding/b.json"],
      },
      exitCode: 5,
    },
  },
  {
    error: new ZitadelConfigConnectionDuplicatedError("google", "Google", [
      GOOGLE_PATH,
      ".zitadel/idps/google-2.json",
    ]),
    main: "lib/zitadel/resources/connections/collection.ts:86",
    expected: {
      code: "E_CONFLICT",
      message: `More than one Google connection exists: ${GOOGLE_PATH}, .zitadel/idps/google-2.json`,
      hint: "Keep the one this project should use and remove the others, then run the command again.",
      details: { provider: "google", files: [GOOGLE_PATH, ".zitadel/idps/google-2.json"] },
      exitCode: 5,
    },
  },
  {
    error: new ZitadelConfigSlugDuplicatedError("acme", [ACME_PATH, ".zitadel/idps/acme-2.json"]),
    main: "lib/zitadel/resources/connections/collection.ts:126",
    expected: {
      code: "E_CONFLICT",
      message: `More than one connection is named acme: ${ACME_PATH}, .zitadel/idps/acme-2.json`,
      hint: "A slug names one connection. Remove or rename all but one, then run the command again.",
      details: { slug: "acme", files: [ACME_PATH, ".zitadel/idps/acme-2.json"] },
      exitCode: 5,
    },
  },
  {
    case: "a schema that offers providers, with connections",
    error: new ZitadelConfigProviderUnknownError("user", "github", ["google"], ["acme"]),
    main: "lib/zitadel/resources/connections/collection.ts:538",
    expected: {
      code: "E_NOT_FOUND",
      message: "user has no provider named github",
      hint: "user offers: google. Connections under .zitadel/idps/: acme.",
      details: { requested: "github", offered: ["google"], connections: ["acme"] },
      exitCode: 4,
    },
  },
  {
    case: "a schema that offers nothing, with no connections",
    error: new ZitadelConfigProviderUnknownError("user", "github", [], []),
    main: "lib/zitadel/resources/connections/collection.ts:538",
    expected: {
      code: "E_NOT_FOUND",
      message: "user has no provider named github",
      hint: "user offers: none. Connections under .zitadel/idps/: none.",
      details: { requested: "github", offered: [], connections: [] },
      exitCode: 4,
    },
  },
  {
    error: new ZitadelConfigConnectionProviderMismatchError(
      GOOGLE_PATH,
      "google",
      "Google",
      "https://accounts.google.com",
    ),
    main: "lib/zitadel/resources/connections/collection.ts:650",
    expected: {
      code: "E_CONFLICT",
      message: `${GOOGLE_PATH} is a connection called google, but not to Google: its issuer is not https://accounts.google.com`,
      hint: "Point it at the provider if it is that connection. Otherwise change its slug, in the file and in the schemas and flows that name it, then run the command again.",
      details: { file: GOOGLE_PATH, slug: "google" },
      exitCode: 5,
    },
  },
  {
    error: new ZitadelConfigCredentialsDoubledError("acme", "ACME_CLIENT"),
    main: "lib/zitadel/resources/connections/collection.ts:718",
    expected: {
      code: "E_CONFLICT",
      message: "This connection points both credentials at ACME_CLIENT",
      hint: "Give client_id and client_secret separate ${{ NAME }} references, then run the command again.",
      details: { slug: "acme", variable: "ACME_CLIENT" },
      exitCode: 5,
    },
  },
  {
    error: new ZitadelConfigVariableSharedError(ACME_PATH, "corp", "acme", "ACME_CLIENT_ID"),
    main: "lib/zitadel/resources/connections/collection.ts:732",
    expected: {
      code: "E_CONFLICT",
      message: `${ACME_PATH} and corp both use ACME_CLIENT_ID`,
      hint: "Point one of them at a variable of its own, then run the command again.",
      details: {
        file: ACME_PATH,
        slug: "corp",
        other_slug: "acme",
        variable: "ACME_CLIENT_ID",
      },
      exitCode: 5,
    },
  },
  {
    error: new ZitadelConfigRegionUneditableError(
      FLOW_PATH,
      "steps.password.sso_providers is not a list",
    ),
    main: "lib/zitadel/resources/document.ts:482",
    expected: {
      code: "E_VALIDATION",
      message: `${FLOW_PATH}: steps.password.sso_providers is not a list`,
      hint: "This command edits that region, and it is not the shape it edits. Fix it against the dialect in .zitadel/meta/, then run the command again.",
      details: { file: FLOW_PATH, region: "steps.password.sso_providers is not a list" },
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigFlowMissingError("user", SCHEMA_PATH),
    main: "lib/zitadel/resources/flows/collection.ts:141",
    expected: {
      code: "E_NOT_FOUND",
      message: "No login flow runs against user",
      hint: "The provider is offered by a flow, and none of the files under .zitadel/flows/ names this schema. Check that the flow's user_schema names the schema's objectType.",
      details: { schema: SCHEMA_PATH },
      exitCode: 4,
    },
  },
  {
    error: new ZitadelConfigRenameActionClashError("password", "sso", "sso_authenticated"),
    main: "lib/zitadel/resources/flows/sso.ts:967",
    expected: {
      code: "E_VALIDATION",
      message:
        'steps.password: transition "sso" is renamed to "sso_authenticated", which is an action on this step',
      hint: 'Rename the action "sso_authenticated" on step "password" (and its transition), then run auth-method sso enable again.',
      details: { step: "password", action: "sso_authenticated" },
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigRenameRouteLossError("password", "sso", "sso_authenticated"),
    main: "lib/zitadel/resources/flows/sso.ts:985",
    expected: {
      code: "E_VALIDATION",
      message:
        'steps.password: transition "sso" declares purpose or action, which "sso_authenticated" cannot',
      hint: 'Remove purpose and action from the transition "sso" on step "password", then run auth-method sso enable again.',
      details: { step: "password", transition: "sso" },
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigOutcomeActionClashError("password", "sso_user_not_found"),
    main: "lib/zitadel/resources/flows/sso.ts:1038",
    expected: {
      code: "E_VALIDATION",
      message:
        'steps.password: action "sso_user_not_found" uses a name auth-method sso enable writes as an outcome on this step',
      hint: 'Rename the action "sso_user_not_found" on step "password" (and its transition), then run auth-method sso enable again.',
      details: { step: "password", action: "sso_user_not_found" },
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigIdentifierMissingError(SCHEMA_PATH),
    main: "lib/zitadel/resources/schemas/schema.ts:514",
    expected: {
      code: "E_VALIDATION",
      message: `${SCHEMA_PATH} has no x-identifier for password`,
      hint: 'A password is checked against the user found by the schema\'s identifier. Set "x-identifier" to the property users sign in with, e.g. "email", then run the command again.',
      details: { file: SCHEMA_PATH, method: "password" },
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigReferenceMissingError(REF),
    main: "lib/zitadel/storage/references.ts:132",
    expected: {
      code: "E_VALIDATION",
      message: `$file ${JSON.stringify(REF)} cannot be read`,
      hint: REFERENCE_HINT,
      exitCode: 3,
    },
  },
  {
    case: "a reference the OS refused with an errno",
    error: new ZitadelConfigReferenceBrokenError(BRANDING_PATH, REF, "EIO", new Error("EIO")),
    main: "lib/zitadel/storage/backend/store.ts:258",
    expected: {
      code: "E_VALIDATION",
      message: `$file ${JSON.stringify(REF)} cannot be read`,
      hint: REFERENCE_HINT,
      details: { file: BRANDING_PATH, ref: REF, code: "EIO" },
      exitCode: 3,
    },
  },
  {
    case: "a reference that failed without an errno",
    error: new ZitadelConfigReferenceBrokenError(BRANDING_PATH, REF, undefined, new Error("boom")),
    main: "lib/zitadel/storage/backend/store.ts:258",
    expected: {
      code: "E_VALIDATION",
      message: `$file ${JSON.stringify(REF)} cannot be read`,
      hint: REFERENCE_HINT,
      details: { file: BRANDING_PATH, ref: REF },
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigReferenceOutsideError("../../secret.txt"),
    main: "lib/zitadel/storage/references.ts:170",
    expected: {
      code: "E_VALIDATION",
      message: '$file "../../secret.txt" points outside the project',
      hint: "Keep referenced files inside the project, next to the file that references them; a symlink on the way must resolve inside the project too.",
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigPathOutsideError("../outside.json"),
    main: "lib/zitadel/storage/references.ts:191",
    expected: {
      code: "E_VALIDATION",
      message: "../outside.json points outside .zitadel/",
      hint: "Files are only written and removed inside .zitadel/.",
      details: { file: "../outside.json" },
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigPathBlockedError(SCHEMA_PATH, ".zitadel/schemas"),
    main: "lib/zitadel/storage/backend/store.ts:465",
    expected: {
      code: "E_VALIDATION",
      message: `${SCHEMA_PATH} cannot be written (ENOTDIR)`,
      hint: "Remove .zitadel/schemas, which is a file where a directory is needed, then run the command again.",
      details: { file: SCHEMA_PATH, code: "ENOTDIR", blocker: ".zitadel/schemas" },
      exitCode: 3,
    },
  },
  {
    error: new ZitadelConfigDirectoryInTheWayError(SCHEMA_PATH),
    main: "lib/zitadel/storage/backend/store.ts:479",
    expected: {
      code: "E_VALIDATION",
      message: `${SCHEMA_PATH} cannot be removed (EISDIR)`,
      hint: `Remove ${SCHEMA_PATH}, which is a directory where a file is expected, then run the command again.`,
      details: { file: SCHEMA_PATH, code: "EISDIR" },
      exitCode: 3,
    },
  },
];
