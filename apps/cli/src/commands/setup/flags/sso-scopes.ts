import { Flags } from "@oclif/core";
import { parseScopes } from "@zitadel/config/idp";

import { refuseBlank } from "../../../lib/oclif/flags";
import { type Refusal, refusalError } from "../../../lib/oclif/refusal";

const SSO_SCOPES_REFUSAL: Refusal = {
  message: "--sso-scopes: {problem}",
  hint: "Fix --sso-scopes and run the command again.",
  details: {
    flag: "--sso-scopes",
  },
};

/**
 * Reads the scopes of a custom connection, refusing one the server would refuse
 * on apply, and keeps it as typed.
 */
function readSsoScopes(input: string): string {
  const trimmed = refuseBlank(input, "--sso-scopes", "the value is empty");
  const parsed = parseScopes(trimmed);
  if (!parsed.ok) {
    throw refusalError(SSO_SCOPES_REFUSAL, {
      problem: parsed.problem,
    });
  }
  return trimmed;
}

/** A flag that holds the scopes of a custom connection. */
export const ssoScopesFlag = Flags.custom<string>({
  parse: async (input) => {
    return readSsoScopes(input);
  },
});
