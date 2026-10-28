import { RECOMMENDED_PASSWORD_MIN_LENGTH } from "@zitadel/config/schemas";
import { type RefObject, useRef } from "react";

import { DetailRow, DetailSection } from "@/components/detail-page";
import { IssueMarker } from "@/components/issue-marker";
import { Badge } from "@/components/ui/badge";
import { PopoverDescription, PopoverHeader, PopoverTitle } from "@/components/ui/popover";
import { useMediaQuery } from "@/hooks/use-media-query";
import { type PasswordPolicyConfig, passwordRequirements } from "@/lib/password-policy";

/** Where the recommendation comes from: the password verifier rules of NIST SP 800-63B. */
const RECOMMENDATION_URL = "https://pages.nist.gov/800-63-4/sp800-63b.html#passwordver";

/**
 * The note is 320px wide and opens 16px past the list. Under `xl` the list's
 * end plus that overruns the viewport with the sidebar open, and Radix would
 * flip the note over the label column, so it opens below the list instead.
 */
const NOTE_BESIDE_LIST = "(min-width: 1280px)";

/**
 * The outcome of reading the project's password policy: its config, `config`
 * undefined when the project never published one, or the API's message when
 * the read failed.
 */
export type PasswordPolicyRead = { config: PasswordPolicyConfig | undefined } | { error: string };

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
  const rules = "config" in password ? passwordRequirements(password.config) : undefined;
  const error = "error" in password ? password.error : undefined;
  const warn = rules?.belowRecommended ?? false;
  const list = useRef<HTMLDListElement>(null);
  return (
    <DetailSection
      title="Policies"
      titleId="project-policies"
      role="region"
      aria-labelledby="project-policies"
    >
      <DetailRow
        divider
        label={
          <>
            Password policy
            {warn && <Badge variant="warning">Warning</Badge>}
          </>
        }
      >
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
                {warn && <BelowRecommendedNote configured={rules.minimumSet} anchor={list} />}
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt>Password history</dt>
              <dd className="text-foreground">{rules.history}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm leading-5 text-muted-foreground">{error}</p>
        )}
      </DetailRow>
    </DetailSection>
  );
}

/**
 * Why the minimum is a warning, with where the recommendation comes from. A
 * minimum the policy sets reads as below it; none at all reads as unset,
 * since nothing was configured. The note opens beside the whole list, past
 * its longest line, so it covers none of the values, or below it where there
 * is no room beside.
 */
function BelowRecommendedNote({
  configured,
  anchor,
}: {
  configured: boolean;
  anchor: RefObject<HTMLElement | null>;
}) {
  const title = configured ? "Below recommended minimum" : "No minimum set";
  const beside = useMediaQuery(NOTE_BESIDE_LIST);
  return (
    <IssueMarker
      tone="warning"
      label={title}
      side={beside ? "right" : "bottom"}
      sideOffset={beside ? 16 : 8}
      align="start"
      anchor={anchor}
      contentClassName="w-80"
    >
      <PopoverHeader className="gap-0.5 text-xs leading-4">
        <PopoverTitle>{title}</PopoverTitle>
        <PopoverDescription>
          {configured
            ? `The configured minimum password length is below the recommended ${RECOMMENDED_PASSWORD_MIN_LENGTH} characters for single-factor authentication.`
            : `No minimum password length is set. The recommended minimum is ${RECOMMENDED_PASSWORD_MIN_LENGTH} characters for single-factor authentication.`}{" "}
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
