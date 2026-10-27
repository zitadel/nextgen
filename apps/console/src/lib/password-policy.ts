import type { ListPolicies200PoliciesItem } from "@zitadel/api/generated/model";
import { RECOMMENDED_PASSWORD_MIN_LENGTH } from "@zitadel/config/schemas";

/**
 * The password policy as the project page reads it (ADR 066): the config of
 * the newest revision of the `auth.factor.password.set` policy, every setting
 * optional and unenforced when left out.
 */
export type PasswordPolicyConfig = ListPolicies200PoliciesItem["config"];

/**
 * The minimum length NIST SP 800-63B sets for a password used as the only
 * factor, which `setup` writes by default. A policy may set any minimum from
 * 1, and the console says so when it is under this.
 */
export const RECOMMENDED_MIN_LENGTH = RECOMMENDED_PASSWORD_MIN_LENGTH;

/** What the password policy enforces, as the project page states it. */
export interface PasswordRequirements {
  minimumLength: string;
  /** The minimum is under {@link RECOMMENDED_MIN_LENGTH}, or there is none. */
  belowRecommended: boolean;
  history: string;
}

/**
 * The password rules in force, from the policy's config or from none. The
 * server enforces nothing for a rule the config leaves out, and without a
 * policy it enforces nothing at all, so both read as what is then allowed
 * rather than as a gap.
 */
export function passwordRequirements(config: PasswordPolicyConfig = {}): PasswordRequirements {
  const { min_length, history_depth } = config;
  return {
    minimumLength:
      min_length === undefined
        ? "No minimum"
        : min_length === 1
          ? "1 character"
          : `${min_length} characters`,
    belowRecommended: (min_length ?? 0) < RECOMMENDED_MIN_LENGTH,
    history:
      history_depth === undefined
        ? "Reuse allowed"
        : history_depth === 1
          ? "Prevent reuse of the last password"
          : `Prevent reuse of last ${history_depth} passwords`,
  };
}
