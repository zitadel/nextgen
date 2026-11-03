import { Flags } from "@oclif/core";
import { type ClientId, parseClientId } from "@zitadel/config/idp";

import { refuseBlank } from "../../../lib/oclif/flags";
import { type Refusal, refusalError } from "../../../lib/oclif/refusal";

const CLIENT_ID_REFUSAL: Refusal = {
  message: "--sso-client-id: {problem}",
  hint: "Fix --sso-client-id and run the command again.",
  details: {
    argument: "--sso-client-id",
  },
};

/** Reads the client id of an OAuth application, refusing one the platform would not accept. */
function readClientId(input: string): ClientId {
  const parsed = parseClientId(refuseBlank(input, "--sso-client-id", "the value is empty"));
  if (!parsed.ok) {
    throw refusalError(CLIENT_ID_REFUSAL, {
      problem: parsed.problem,
    });
  }
  return parsed.value;
}

/** A flag that holds the client id of the application registered with the provider. */
export const clientIdFlag = Flags.custom<ClientId>({
  parse: async (input) => {
    return readClientId(input);
  },
});
