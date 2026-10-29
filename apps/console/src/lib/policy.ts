import type { GetPolicyRevision200 } from "@zitadel/api/generated/model";

import { humanise } from "./flow-definition";

/**
 * Display helpers for operation policies (ADR 066).
 *
 * A policy is typed by the operation it guards; the password policy is the
 * only one the catalog lists today. The release detail shows a pinned policy
 * revision as a short summary of its settings above its document, so the
 * helpers here turn the typed config into those rows and that document.
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

interface PolicyDisplay {
  name: string;
  settings: (config: PasswordPolicyConfig) => PolicySetting[];
}

/**
 * How each operation's policy reads. An operation the console does not know
 * yet, from a server whose catalog has grown, is named from the operation and
 * shows its document alone.
 */
const POLICIES: Partial<Record<string, PolicyDisplay>> = {
  "auth.factor.password.set": { name: "Password policy", settings: passwordPolicySettings },
};

/** The policy's name, by the operation it guards. */
export function policyDisplayName(operation: string): string {
  return POLICIES[operation]?.name ?? humanise(operation);
}

/** The settings rows for a revision, by its operation. */
export function policySettings(revision: PolicyRevision): PolicySetting[] {
  return POLICIES[revision.operation]?.settings(revision.config) ?? [];
}

/**
 * The password policy's settings as the design's rows: the length rule and
 * whether history is checked. A rule the config leaves out is off and gets no
 * row, as a kind the release does not pin gets no group, so `{}` shows the
 * document alone.
 */
export function passwordPolicySettings(config: PasswordPolicyConfig): PolicySetting[] {
  const rows: PolicySetting[] = [];
  const length = lengthRule(config);
  if (length) rows.push({ label: "Length", value: length });
  if (config.history_depth !== undefined) rows.push({ label: "History", value: "Enabled" });
  return rows;
}

function lengthRule({ min_length, max_length }: PasswordPolicyConfig): string | undefined {
  if (min_length !== undefined && max_length !== undefined) {
    return `${min_length} to ${max_length} characters`;
  }
  if (min_length !== undefined) return `At least ${min_length} characters`;
  if (max_length !== undefined) return `At most ${max_length} characters`;
  return undefined;
}

/**
 * The document the operator owns: the operation and its config, which is the
 * body `POST /policies` takes and what `.zitadel/policies/<operation>.json`
 * holds beside its editor `$schema`. The ids and timestamps the read carries
 * are the revision's, not the policy's.
 */
export function policyDocument(revision: PolicyRevision): {
  operation: PolicyOperation;
  config: PasswordPolicyConfig;
} {
  return { operation: revision.operation, config: revision.config };
}
