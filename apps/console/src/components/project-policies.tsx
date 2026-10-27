import { type RefObject, useRef } from "react";

import { DetailSection } from "@/components/detail-page";
import { IssueMarker } from "@/components/issue-marker";
import { Badge } from "@/components/ui/badge";
import { PopoverDescription, PopoverHeader, PopoverTitle } from "@/components/ui/popover";
import {
  type PasswordPolicyConfig,
  RECOMMENDED_MIN_LENGTH,
  passwordRequirements,
} from "@/lib/password-policy";

/** Where the recommendation comes from: the password verifier rules of NIST SP 800-63B. */
const RECOMMENDATION_URL = "https://pages.nist.gov/800-63-4/sp800-63b.html#passwordver";

/**
 * The outcome of reading the project's password policy: its config, `config`
 * undefined when the project never published one, or `undefined` as a whole
 * when the read failed.
 */
export type PasswordPolicyRead = { config: PasswordPolicyConfig | undefined } | undefined;

/**
 * The project's policies, read-only: one row per policy the catalog lists,
 * which today is the password policy alone. The row states the rules in
 * force, and a minimum under the recommended length carries a warning badge
 * and, on the value, a glyph that opens the note on why.
 *
 * The policy is published from the CLI with the rest of the project's
 * configuration (ADR 066), so there is nothing to edit here.
 */
export function ProjectPolicies({ password }: { password: PasswordPolicyRead }) {
  const rules = password && passwordRequirements(password.config);
  const warn = rules?.belowRecommended ?? false;
  const list = useRef<HTMLDListElement>(null);
  return (
    <DetailSection
      title="Policies"
      titleId="project-policies"
      className="mt-4"
      role="region"
      aria-labelledby="project-policies"
    >
      {/* The label column and the gap the origins rows above use, so both
          cards' values start on one edge. */}
      <div className="flex flex-col gap-1 border-b border-border py-3 sm:flex-row sm:items-start sm:gap-6">
        <div className="flex shrink-0 items-center gap-1.5 sm:w-48">
          <span className="text-sm leading-5 text-foreground">Password policy</span>
          {warn && <Badge variant="warning">Warning</Badge>}
        </div>
        {rules ? (
          <dl
            ref={list}
            className="flex min-w-0 flex-col gap-1.5 text-sm leading-5 text-muted-foreground"
          >
            <div className="flex items-center gap-1.5">
              <dt>Minimum length</dt>
              {/* The value in foreground against the muted label, as the release
                  detail's rows: the two sit 6px apart with nothing between them. */}
              <dd className="flex items-center gap-1.5 text-foreground">
                {rules.minimumLength}
                {warn && (
                  <BelowRecommendedNote
                    configured={password.config?.min_length !== undefined}
                    anchor={list}
                  />
                )}
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt>Password history</dt>
              <dd className="text-foreground">{rules.history}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm leading-5 text-muted-foreground">
            The password policy could not be read.
          </p>
        )}
      </div>
    </DetailSection>
  );
}

/**
 * Why the minimum is a warning, with where the recommendation comes from. A
 * minimum the policy sets reads as below it; none at all reads as unset,
 * since nothing was configured. The note opens to the right of the whole
 * list, past its longest line, so it covers none of the values.
 */
function BelowRecommendedNote({
  configured,
  anchor,
}: {
  configured: boolean;
  anchor: RefObject<HTMLElement | null>;
}) {
  const title = configured ? "Below recommended minimum" : "No minimum set";
  return (
    <IssueMarker
      tone="warning"
      label={title}
      side="right"
      sideOffset={16}
      align="start"
      anchor={anchor}
      contentClassName="w-80"
    >
      <PopoverHeader className="gap-0.5 text-xs leading-4">
        <PopoverTitle>{title}</PopoverTitle>
        <PopoverDescription>
          {configured
            ? `The configured minimum password length is below the recommended ${RECOMMENDED_MIN_LENGTH} characters for single-factor authentication.`
            : `No minimum password length is set. The recommended minimum is ${RECOMMENDED_MIN_LENGTH} characters for single-factor authentication.`}{" "}
          <a
            href={RECOMMENDATION_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Learn more about the recommended minimum"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Learn more
          </a>
        </PopoverDescription>
      </PopoverHeader>
    </IssueMarker>
  );
}
