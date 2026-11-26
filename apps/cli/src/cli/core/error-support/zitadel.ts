import {
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
  ZitadelConfigSchemaExternalError,
  ZitadelConfigResourceClashError,
  ZitadelConfigResourceMissingError,
  ZitadelConfigSchemaAmbiguousError,
  ZitadelConfigSchemaMissingError,
  ZitadelConfigSettingUnusableError,
  ZitadelConfigSignupPolicyInvalidError,
  ZitadelConfigSlugDuplicatedError,
  ZitadelConfigVariableSharedError,
} from "@/lib/zitadel";

import type { Refusal } from "@/cli/core/refusal";
import { derived, type Wording } from "./wording";

/** How {@link ZitadelConfigConnectionNotOidcError} is refused. */
const CONNECTION_NOT_OIDC_REFUSAL = {
  message: "{message}",
  hint: "Fix the file, or choose another slug, then run the command again.",
  details: {
    file: "{path}",
    slug: "{slug}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigConnectionIssuerClashError} is refused. */
const CONNECTION_ISSUER_CLASH_REFUSAL = {
  message: "{message}",
  hint: "An applied connection keeps its issuer, and the server compares it exactly, so even a trailing slash names another provider. Choose another slug for this connection, then move the schemas and flows that name the old one to it.",
  details: {
    file: "{path}",
    slug: "{slug}",
    issuer: "{issuer}",
    existing_issuer: "{existingIssuer}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigProviderFileTakenError} is refused. */
const PROVIDER_FILE_TAKEN_REFUSAL = {
  message: "{message}",
  hint: "Rename or remove that file, then run the command again.",
  details: {
    file: "{path}",
    slug: "{slug}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigConnectionFileTakenError} is refused. */
const CONNECTION_FILE_TAKEN_REFUSAL = {
  message: "{message}",
  hint: "Rename or remove that file, or choose another slug, then run the command again.",
  details: {
    file: "{path}",
    slug: "{slug}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigSchemaMissingError} is refused. */
const SCHEMA_MISSING_REFUSAL = {
  message: "{message}",
} as const satisfies Refusal;

/** How {@link ZitadelConfigReferenceUnreadableError} is refused. */
const REFERENCE_UNREADABLE_REFUSAL = {
  message: "{message}",
  hint: "Create the referenced file or fix the path.",
  details: {
    file: "{path}",
    ref: "{ref}",
    code: "{errno}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigHandleClashError} is refused. */
const HANDLE_CLASH_REFUSAL = {
  message: "{message}",
  hint: "Remove or fix all but one of them, then run the command again.",
  details: {
    handle: "{handle}",
    paths: "{paths}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigConnectionDuplicatedError} is refused. */
const CONNECTION_DUPLICATED_REFUSAL = {
  message: "{message}",
  hint: "Keep the one this project should use and remove the others, then run the command again.",
  details: {
    provider: "{provider}",
    files: "{paths}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigSlugDuplicatedError} is refused. */
const SLUG_DUPLICATED_REFUSAL = {
  message: "{message}",
  hint: "A slug names one connection. Remove or rename all but one, then run the command again.",
  details: {
    slug: "{slug}",
    files: "{paths}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigProviderUnknownError} is refused. */
const PROVIDER_UNKNOWN_REFUSAL = {
  message: "{message}",
  hint: "{schema} offers: {offeredList}. Connections under .zitadel/idps/: {connectionList}.",
} as const satisfies Refusal;

/** How {@link ZitadelConfigConnectionProviderMismatchError} is refused. */
const CONNECTION_PROVIDER_MISMATCH_REFUSAL = {
  message: "{message}",
  hint: "Point it at the provider if it is that connection. Otherwise change its slug, in the file and in the schemas and flows that name it, then run the command again.",
  details: {
    file: "{path}",
    slug: "{slug}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigCredentialsDoubledError} is refused. */
const CREDENTIALS_DOUBLED_REFUSAL = {
  message: "{message}",
  hint: "Give client_id and client_secret separate ${{ NAME }} references, then run the command again.",
  details: {
    slug: "{slug}",
    variable: "{variable}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigVariableSharedError} is refused. */
const VARIABLE_SHARED_REFUSAL = {
  message: "{message}",
  hint: "Point one of them at a variable of its own, then run the command again.",
  details: {
    file: "{path}",
    slug: "{slug}",
    other_slug: "{otherSlug}",
    variable: "{variable}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigFlowMissingError} is refused. */
const FLOW_MISSING_REFUSAL = {
  message: "{message}",
  hint: "The provider is offered by a flow, and none of the files under .zitadel/flows/ names this schema. Check that the flow's user_schema names the schema's objectType.",
  details: {
    schema: "{path}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigReferenceBrokenError} is refused. */
const REFERENCE_BROKEN_REFUSAL = {
  message: "{message}",
  hint: "Create the referenced file or fix the path.",
  details: {
    file: "{path}",
    ref: "{ref}",
    code: "{errno}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigFlowMethodInUseError} is refused. */
const FLOW_METHOD_IN_USE_REFUSAL = {
  message: "{message}",
} as const satisfies Refusal;

/** How {@link ZitadelConfigFlowBrokenError} is refused. */
const FLOW_BROKEN_REFUSAL = {
  message: "{message}",
  hint: "Fix the steps named above, then run the command again.",
} as const satisfies Refusal;

/** How {@link ZitadelConfigFlowUncheckedError} is refused. */
const FLOW_UNCHECKED_REFUSAL = {
  message: "{message}",
  hint: "Fix those errors first (`zitadel deploy --dry-run` reports them too), then run the command again.",
  next: [
    {
      id: "deploy",
      flags: {
        dryRun: true,
      },
    },
  ],
} as const satisfies Refusal;

/** How {@link ZitadelConfigFilesBrokenError} is refused. */
const FILES_BROKEN_REFUSAL = {
  message: "{message}",
  hint: "Fix the files named above, then run the command again; nothing was changed.",
  details: {
    problems: "{problems}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigNothingToDeployError} is refused. */
const NOTHING_TO_DEPLOY_REFUSAL = {
  message: "{message}",
  hint: "Add a schema, flow, policy or branding under .zitadel/, or run `zitadel setup` to scaffold one.",
} as const satisfies Refusal;

/** How {@link ZitadelConfigClientIdMismatchError} is refused. */
const CLIENT_ID_MISMATCH_REFUSAL = {
  message: "{message}",
  hint: "Edit the connection file to change its client id, or run the command without one to reuse it.",
  details: {
    file: "{path}",
    stored_client_id: "{stored}",
    supplied_client_id: "{supplied}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigSettingUnusableError} is refused. */
const SETTING_UNUSABLE_REFUSAL = {
  message: "{message}",
  hint: "Fix it in that file, or choose another slug.",
  details: {
    file: "{path}",
    slug: "{slug}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigPathUnreadableError} is refused. */
const PATH_UNREADABLE_REFUSAL = {
  message: "{message}",
  hint: "Check that the file is readable, then run the command again.",
  details: {
    file: "{path}",
    code: "{errno}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigResourceClashError} is refused. */
const RESOURCE_CLASH_REFUSAL = {
  message: "{message}",
} as const satisfies Refusal;

/** How {@link ZitadelConfigResourceMissingError} is refused. */
const RESOURCE_MISSING_REFUSAL = {
  message: "{message}",
} as const satisfies Refusal;

/** How {@link ZitadelConfigSchemaAmbiguousError} is refused. */
const SCHEMA_AMBIGUOUS_REFUSAL = {
  message: "{message}",
} as const satisfies Refusal;

/** How {@link ZitadelConfigEditLockoutError} is refused. */
const EDIT_LOCKOUT_REFUSAL = {
  message: "{message}",
  details: {
    file: "{path}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigFileExistsError} is refused. */
const FILE_EXISTS_REFUSAL = {
  message: "{message}",
  hint: "Move or rename the file that is already there, then run the command again.",
  details: {
    file: "{path}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigConnectionExistsError} is refused. */
const CONNECTION_EXISTS_REFUSAL = {
  message: "{message}",
  hint: "A connection file is yours to keep, so it is never replaced or removed. Remove it to scaffold a fresh one, or keep it and enable the provider to reuse it.",
  details: {
    file: "{path}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigFileUnreadableError} is refused. */
const FILE_UNREADABLE_REFUSAL = {
  message: "{message}",
  hint: "Check that the file is readable, then run the command again.",
  details: {
    file: "{path}",
    code: "{errno}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigBrandingDuplicatedError} is refused. */
const BRANDING_DUPLICATED_REFUSAL = {
  message: "{message}",
  hint: "A project has a single branding; keep one descriptor under .zitadel/branding/.",
} as const satisfies Refusal;

/** How {@link ZitadelConfigPasswordPolicyInvalidError} is refused. */
const PASSWORD_POLICY_INVALID_REFUSAL = {
  message: "{message}",
  hint: "Setup keeps an existing policy file and deploys it, so fix it against .zitadel/meta/policy.json or move it aside to start from an empty one.",
  details: {
    file: "{path}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigSignupPolicyInvalidError} is refused. */
const SIGNUP_POLICY_INVALID_REFUSAL = {
  message: "{message}",
  hint: "Setup keeps an existing policy file and deploys it, so fix it against .zitadel/meta/policy.json or move it aside to start from the default.",
  details: {
    file: "{path}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigHandleInvalidError} is refused. */
const HANDLE_INVALID_REFUSAL = {
  message: "{message}",
  hint: "A handle must be a single name, without slashes or dots that climb out of its directory.",
  details: {
    handle: "{handle}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigRegionUneditableError} is refused. */
const REGION_UNEDITABLE_REFUSAL = {
  message: "{message}",
  hint: "This command edits that region, and it is not the shape it edits. Fix it against the dialect in .zitadel/meta/, then run the command again.",
  details: {
    file: "{path}",
    region: "{region}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigRenameActionClashError} is refused. */
const RENAME_ACTION_CLASH_REFUSAL = {
  message: "{message}",
  hint: 'Rename the action "{action}" on step "{step}" (and its transition), then run auth-method sso enable again.',
  details: {
    step: "{step}",
    action: "{action}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigRenameRouteLossError} is refused. */
const RENAME_ROUTE_LOSS_REFUSAL = {
  message: "{message}",
  hint: 'Remove purpose and action from the transition "{transition}" on step "{step}", then run auth-method sso enable again.',
  details: {
    step: "{step}",
    transition: "{transition}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigOutcomeActionClashError} is refused. */
const OUTCOME_ACTION_CLASH_REFUSAL = {
  message: "{message}",
  hint: 'Rename the action "{action}" on step "{step}" (and its transition), then run auth-method sso enable again.',
  details: {
    step: "{step}",
    action: "{action}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigIdentifierMissingError} is refused. */
const IDENTIFIER_MISSING_REFUSAL = {
  message: "{message}",
  hint: 'A password is checked against the user found by the schema\'s identifier. Set "x-identifier" to the property users sign in with, e.g. "email", then run the command again.',
  details: {
    file: "{path}",
    method: "password",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigReferenceMissingError} is refused. */
const REFERENCE_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Create the referenced file or fix the path.",
} as const satisfies Refusal;

/** How {@link ZitadelConfigReferenceOutsideError} is refused. */
const REFERENCE_OUTSIDE_REFUSAL = {
  message: "{message}",
  hint: "Keep referenced files inside the project, next to the file that references them; a symlink on the way must resolve inside the project too.",
} as const satisfies Refusal;

/** How {@link ZitadelConfigPathOutsideError} is refused. */
const PATH_OUTSIDE_REFUSAL = {
  message: "{message}",
  hint: "Files are only written and removed inside .zitadel/.",
  details: {
    file: "{path}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigPathBlockedError} is refused. */
const PATH_BLOCKED_REFUSAL = {
  message: "{message}",
  hint: "Remove {blocker}, which is a file where a directory is needed, then run the command again.",
  details: {
    file: "{path}",
    code: "ENOTDIR",
    blocker: "{blocker}",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigDirectoryInTheWayError} is refused. */
const DIRECTORY_IN_THE_WAY_REFUSAL = {
  message: "{message}",
  hint: "Remove {path}, which is a directory where a file is expected, then run the command again.",
  details: {
    file: "{path}",
    code: "EISDIR",
  },
} as const satisfies Refusal;

/** How {@link ZitadelConfigSchemaExternalError} is refused. */
const SCHEMA_EXTERNAL_REFUSAL = {
  message: "{message}",
  hint: "Its sign-in methods live in the schema at its url, which the server fetches. Edit x-auth-methods there instead.",
} as const satisfies Refusal;

/** How {@link ZitadelConfigError} is refused. */
const CONFIG_REFUSAL = {
  message: "{message}",
} as const satisfies Refusal;

/**
 * How the errors of `@/lib/zitadel` are worded, most specific class first.
 * `ZitadelConfigInternalError` is a bug in the package, not a refusal, so it
 * has none.
 */
export const ZITADEL_WORDINGS: readonly Wording[] = [
  [ZitadelConfigConnectionNotOidcError, CONNECTION_NOT_OIDC_REFUSAL],
  [ZitadelConfigConnectionIssuerClashError, CONNECTION_ISSUER_CLASH_REFUSAL],
  [ZitadelConfigProviderFileTakenError, PROVIDER_FILE_TAKEN_REFUSAL],
  [ZitadelConfigConnectionFileTakenError, CONNECTION_FILE_TAKEN_REFUSAL],
  [ZitadelConfigSchemaMissingError, SCHEMA_MISSING_REFUSAL],
  [ZitadelConfigReferenceUnreadableError, REFERENCE_UNREADABLE_REFUSAL],
  [ZitadelConfigHandleClashError, HANDLE_CLASH_REFUSAL],
  [ZitadelConfigConnectionDuplicatedError, CONNECTION_DUPLICATED_REFUSAL],
  [ZitadelConfigSlugDuplicatedError, SLUG_DUPLICATED_REFUSAL],
  derived(ZitadelConfigProviderUnknownError, PROVIDER_UNKNOWN_REFUSAL, (error) => {
    return {
      values: {
        offeredList: error.offered.join(", ") || "none",
        connectionList: error.connections.join(", ") || "none",
      },
    };
  }),
  [ZitadelConfigConnectionProviderMismatchError, CONNECTION_PROVIDER_MISMATCH_REFUSAL],
  [ZitadelConfigCredentialsDoubledError, CREDENTIALS_DOUBLED_REFUSAL],
  [ZitadelConfigVariableSharedError, VARIABLE_SHARED_REFUSAL],
  [ZitadelConfigFlowMissingError, FLOW_MISSING_REFUSAL],
  [ZitadelConfigReferenceBrokenError, REFERENCE_BROKEN_REFUSAL],
  [ZitadelConfigFlowMethodInUseError, FLOW_METHOD_IN_USE_REFUSAL],
  [ZitadelConfigFlowBrokenError, FLOW_BROKEN_REFUSAL],
  [ZitadelConfigFlowUncheckedError, FLOW_UNCHECKED_REFUSAL],
  [ZitadelConfigFilesBrokenError, FILES_BROKEN_REFUSAL],
  [ZitadelConfigNothingToDeployError, NOTHING_TO_DEPLOY_REFUSAL],
  [ZitadelConfigClientIdMismatchError, CLIENT_ID_MISMATCH_REFUSAL],
  [ZitadelConfigSettingUnusableError, SETTING_UNUSABLE_REFUSAL],
  [ZitadelConfigPathUnreadableError, PATH_UNREADABLE_REFUSAL],
  [ZitadelConfigResourceClashError, RESOURCE_CLASH_REFUSAL],
  [ZitadelConfigResourceMissingError, RESOURCE_MISSING_REFUSAL],
  [ZitadelConfigSchemaAmbiguousError, SCHEMA_AMBIGUOUS_REFUSAL],
  [ZitadelConfigEditLockoutError, EDIT_LOCKOUT_REFUSAL],
  [ZitadelConfigFileExistsError, FILE_EXISTS_REFUSAL],
  [ZitadelConfigConnectionExistsError, CONNECTION_EXISTS_REFUSAL],
  [ZitadelConfigFileUnreadableError, FILE_UNREADABLE_REFUSAL],
  [ZitadelConfigBrandingDuplicatedError, BRANDING_DUPLICATED_REFUSAL],
  [ZitadelConfigPasswordPolicyInvalidError, PASSWORD_POLICY_INVALID_REFUSAL],
  [ZitadelConfigSignupPolicyInvalidError, SIGNUP_POLICY_INVALID_REFUSAL],
  [ZitadelConfigHandleInvalidError, HANDLE_INVALID_REFUSAL],
  [ZitadelConfigRegionUneditableError, REGION_UNEDITABLE_REFUSAL],
  [ZitadelConfigRenameActionClashError, RENAME_ACTION_CLASH_REFUSAL],
  [ZitadelConfigRenameRouteLossError, RENAME_ROUTE_LOSS_REFUSAL],
  [ZitadelConfigOutcomeActionClashError, OUTCOME_ACTION_CLASH_REFUSAL],
  [ZitadelConfigIdentifierMissingError, IDENTIFIER_MISSING_REFUSAL],
  [ZitadelConfigReferenceMissingError, REFERENCE_MISSING_REFUSAL],
  [ZitadelConfigReferenceOutsideError, REFERENCE_OUTSIDE_REFUSAL],
  [ZitadelConfigPathOutsideError, PATH_OUTSIDE_REFUSAL],
  [ZitadelConfigPathBlockedError, PATH_BLOCKED_REFUSAL],
  [ZitadelConfigDirectoryInTheWayError, DIRECTORY_IN_THE_WAY_REFUSAL],
  [ZitadelConfigSchemaExternalError, SCHEMA_EXTERNAL_REFUSAL],
  [ZitadelConfigError, CONFIG_REFUSAL],
];
