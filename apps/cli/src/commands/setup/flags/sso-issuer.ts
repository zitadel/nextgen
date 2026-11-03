import { Flags } from "@oclif/core";
import { parseIssuer } from "@zitadel/config/idp";

import { refuseBlank } from "../../../lib/oclif/flags";
import { type Refusal, refusalError } from "../../../lib/oclif/refusal";

const SSO_ISSUER_REFUSAL: Refusal = {
  message: "--sso-issuer: {problem}",
  hint: "Fix --sso-issuer and run the command again.",
  details: {
    flag: "--sso-issuer",
  },
};

/**
 * Reads the issuer of a custom connection, refusing one the server would refuse
 * on apply, and keeps it as typed.
 */
function readSsoIssuer(input: string): string {
  const trimmed = refuseBlank(input, "--sso-issuer", "the value is empty");
  const parsed = parseIssuer(trimmed);
  if (!parsed.ok) {
    throw refusalError(SSO_ISSUER_REFUSAL, {
      problem: parsed.problem,
    });
  }
  return trimmed;
}

/** A flag that holds the issuer of a custom connection. */
export const ssoIssuerFlag = Flags.custom<string>({
  parse: async (input) => {
    return readSsoIssuer(input);
  },
});
