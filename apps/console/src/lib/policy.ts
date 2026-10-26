import type { GetPolicyRevision200 } from "@zitadel/api/generated/model";

/**
 * Display helpers for operation policies (ADR 066).
 *
 * A policy is typed by the operation it guards; the password policy is the
 * only one the catalog lists today. The release detail shows a pinned policy
 * revision as a short summary of its settings above the document the CLI
 * publishes, so the helpers here turn the typed config into those rows and
 * that document.
 */

/** One revision of a policy, as `GET /policies/revisions/{revision_id}` reads it. */
export type PolicyRevision = GetPolicyRevision200;

export type PolicyOperation = PolicyRevision["operation"];

/** The settings of the password policy; every one optional, and off when left out. */
export type PasswordPolicyConfig = PolicyRevision["config"];

/** One row of a policy's settings summary. */
export interface PolicySetting {
  label: string;
  value: string;
}

/** The policy's name, by the operation it guards. */
export function policyDisplayName(operation: PolicyOperation): string {
  switch (operation) {
    case "auth.factor.password.set":
      return "Password policy";
  }
}

/**
 * The password policy's settings as the design's two rows: the length rule
 * and whether history is checked. A rule the config leaves out is off, and the
 * 64 code-point cap applies either way, so a policy with no length setting is
 * one with no length rule of its own rather than no limit.
 */
export function passwordPolicySettings(config: PasswordPolicyConfig): PolicySetting[] {
  return [
    { label: "Length", value: lengthRule(config) },
    { label: "History", value: config.history_depth === undefined ? "Off" : "Enabled" },
  ];
}

function lengthRule({ min_length, max_length }: PasswordPolicyConfig): string {
  if (min_length !== undefined && max_length !== undefined) {
    return `${min_length} to ${max_length} characters`;
  }
  if (min_length !== undefined) return `At least ${min_length} characters`;
  if (max_length !== undefined) return `At most ${max_length} characters`;
  return "Off";
}

/** The settings rows for a revision, by its operation. */
export function policySettings(revision: PolicyRevision): PolicySetting[] {
  switch (revision.operation) {
    case "auth.factor.password.set":
      return passwordPolicySettings(revision.config);
  }
}

/**
 * The document the operator edits: the `.zitadel/policies/<operation>.json`
 * file the CLI publishes, which is the operation and its config. The ids and
 * timestamps the read carries are the revision's, not the file's.
 */
export function policyDocument(revision: PolicyRevision): {
  operation: PolicyOperation;
  config: PasswordPolicyConfig;
} {
  return { operation: revision.operation, config: revision.config };
}
