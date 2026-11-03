import { Flags } from "@oclif/core";
import { RESERVED_SLUGS, parseConnectionSlug } from "@zitadel/config/idp";

import { refuseBlank } from "../../../lib/oclif/flags";
import { type Refusal, refusalError } from "../../../lib/oclif/refusal";

export const SSO_SLUG_REFUSAL: Refusal = {
  message: "--sso-slug: {problem}",
  hint: "Fix --sso-slug and run the command again.",
  details: {
    flag: "--sso-slug",
  },
};

/**
 * Reads the connection slug of a custom connection, refusing one the server would refuse
 * on apply, and keeps it as typed.
 */
export function readSsoSlug(input: string): string {
  const trimmed = refuseBlank(input, "--sso-slug", "the value is empty");
  const parsed = parseConnectionSlug(trimmed, RESERVED_SLUGS);
  if (!parsed.ok) {
    throw refusalError(SSO_SLUG_REFUSAL, {
      problem: parsed.problem,
    });
  }
  return trimmed;
}

/** A flag that holds the connection slug of a custom connection. */
export const ssoSlugFlag = Flags.custom<string>({
  parse: async (input) => {
    return readSsoSlug(input);
  },
});
