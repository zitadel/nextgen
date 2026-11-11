import { DetailRow, DetailSection } from "@/components/detail-page";
import {
  type PasswordPolicyConfig,
  passwordRequirements,
} from "@/features/project-settings/password-policy";

/**
 * The outcome of reading the project's password policy: the config the
 * release on its primary origins pins, `config` undefined when that release
 * pins none, `deployed: false` when nothing is deployed there, or the API's
 * message when the read failed.
 */
export type PasswordPolicyRead =
  | { config: PasswordPolicyConfig | undefined }
  | { deployed: false }
  | { error: string };

/** What the card says while the primary origins serve nothing. */
const NOT_DEPLOYED =
  "Nothing is deployed to the primary origins yet. The password policy of the release you deploy applies then.";

/**
 * The project's policies, read-only: one row per policy the catalog lists,
 * which today is the password policy alone. The row states the rules in
 * force as the policy file sets them, without grading them (ADR 066).
 *
 * The policy is published from the CLI with the rest of the project's
 * configuration (ADR 066), so there is nothing to edit here.
 */
export function ProjectPolicies({ password }: { password: PasswordPolicyRead }) {
  const rules = "config" in password ? passwordRequirements(password.config) : undefined;
  const message =
    "error" in password ? password.error : "deployed" in password ? NOT_DEPLOYED : undefined;
  return (
    <DetailSection
      title="Policies"
      titleId="project-policies"
      role="region"
      aria-labelledby="project-policies"
    >
      <DetailRow divider label="Password policy">
        {rules ? (
          <dl className="flex min-w-0 flex-col gap-1.5 text-sm leading-5 text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <dt>Minimum length</dt>
              {/* The value in foreground against the muted label, as the release
                  detail's rows: the two sit 6px apart with nothing between them. */}
              <dd className="text-foreground">{rules.minimumLength}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt>Password history</dt>
              <dd className="text-foreground">{rules.history}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm leading-5 text-muted-foreground">{message}</p>
        )}
      </DetailRow>
    </DetailSection>
  );
}
