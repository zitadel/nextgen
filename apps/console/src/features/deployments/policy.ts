import type { GetPolicyRevision200 } from "@zitadel/api/generated/model";

/**
 * Display helpers for operation policies (ADR 066).
 *
 * A policy is typed by the operation it guards. The release detail shows a
 * pinned policy revision as a short summary of its settings above its
 * document, so the helpers here turn the typed config into those rows and
 * that document.
 */

/** One revision of a policy, as `GET /policies/revisions/{revision_id}` reads it. */
type PolicyRevision = GetPolicyRevision200;

/** The settings of the password policy; every one optional, and off when left out. */
type PasswordPolicyConfig = Extract<
  PolicyRevision,
  { operation: "auth.factor.password.set" }
>["config"];

/** The settings of the sign-up policy; left out, the server's own challenge applies. */
type UserCreatePolicyConfig = Extract<PolicyRevision, { operation: "user.create" }>["config"];

/** One row of a policy's settings summary. */
export interface PolicySetting {
  label: string;
  value: string;
}

/**
 * Each operation's policy name. An operation the console does not know yet,
 * from a server whose catalog has grown, is named by the operation as
 * written, which is the file name the operator edits, and shows its document
 * alone.
 */
const POLICY_NAMES: Partial<Record<string, string>> = {
  "auth.factor.password.set": "Password policy",
  "user.create": "Sign-up policy",
};

/** The policy's name, by the operation it guards. */
export function policyDisplayName(operation: string): string {
  return POLICY_NAMES[operation] ?? operation;
}

/** The settings rows for a revision, by its operation. */
export function policySettings(revision: PolicyRevision): PolicySetting[] {
  switch (revision.operation) {
    case "auth.factor.password.set":
      return passwordPolicySettings(revision.config);
    case "user.create":
      return userCreatePolicySettings(revision.config);
    default:
      return [];
  }
}

/** What each challenge a sign-up policy can name is called. */
const CHALLENGES: Record<NonNullable<UserCreatePolicyConfig["challenge"]>, string> = {
  zitadel_pow: "Built-in proof of work",
};

/**
 * The sign-up policy's settings as rows: the challenge it names. Left out, it
 * gets no row, as a password rule left out does; the server's own challenge
 * applies then.
 */
export function userCreatePolicySettings(config: UserCreatePolicyConfig): PolicySetting[] {
  return config.challenge === undefined
    ? []
    : [{ label: "Challenge", value: CHALLENGES[config.challenge] }];
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
    if (min_length === max_length) return `Exactly ${min_length} characters`;
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
export function policyDocument(
  revision: PolicyRevision,
): Pick<PolicyRevision, "operation" | "config"> {
  return { operation: revision.operation, config: revision.config };
}
