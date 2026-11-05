import type { ListPolicies200PoliciesItem } from "@zitadel/api/generated/model";
import { RECOMMENDED_PASSWORD_MIN_LENGTH } from "@zitadel/config/schemas";

/**
 * The password policy as the project page reads it (ADR 066): the config of
 * the newest revision of the `auth.factor.password.set` policy, every setting
 * optional and unenforced when left out.
 */
export type PasswordPolicyConfig = ListPolicies200PoliciesItem["config"];

/** What the password policy enforces, as the project page states it. */
export interface PasswordRequirements {
  minimumLength: string;
  /** The policy sets a minimum, whatever its value. */
  minimumSet: boolean;
  /** The minimum is under {@link RECOMMENDED_PASSWORD_MIN_LENGTH}, or there is none. */
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
    minimumSet: min_length !== undefined,
    belowRecommended: (min_length ?? 0) < RECOMMENDED_PASSWORD_MIN_LENGTH,
    history:
      history_depth === undefined
        ? "Reuse allowed"
        : history_depth === 1
          ? "Prevent reuse of the last password"
          : `Prevent reuse of the last ${history_depth} passwords`,
  };
}
