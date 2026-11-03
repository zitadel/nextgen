import { Flags } from "@oclif/core";
import { parseDisplayName } from "@zitadel/config/idp";

import { refuseBlank } from "../../../lib/oclif/flags";
import { type Refusal, refusalError } from "../../../lib/oclif/refusal";

const SSO_DISPLAY_NAME_REFUSAL: Refusal = {
  message: "--sso-display-name: {problem}",
  hint: "Fix --sso-display-name and run the command again.",
  details: {
    flag: "--sso-display-name",
  },
};

/**
 * Reads the display name of a custom connection, refusing one the server would refuse
 * on apply, and keeps it as typed.
 */
function readSsoDisplayName(input: string): string {
  const trimmed = refuseBlank(input, "--sso-display-name", "the value is empty");
  const parsed = parseDisplayName(trimmed);
  if (!parsed.ok) {
    throw refusalError(SSO_DISPLAY_NAME_REFUSAL, {
      problem: parsed.problem,
    });
  }
  return trimmed;
}

/** A flag that holds the display name of a custom connection. */
export const ssoDisplayNameFlag = Flags.custom<string>({
  parse: async (input) => {
    return readSsoDisplayName(input);
  },
});
