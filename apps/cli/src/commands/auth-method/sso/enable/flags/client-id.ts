import { Flags } from "@oclif/core";
import { type ClientId, parseClientId, validated } from "@zitadel/config/idp";

import { refuseBlank } from "../../../../../lib/oclif/flags";

/**
 * The client id a value holds, trimmed as the one a prompt would have accepted.
 * Refuses a blank value, naming `flag`, and one the provider cannot have issued.
 */
export function readClientId(input: string, flag: string): ClientId {
  return validated(parseClientId(refuseBlank(input, flag, `${flag} was given an empty value`)));
}

/** A client id flag, refused before the command runs by {@link readClientId}. */
export const clientIdFlag = Flags.custom<ClientId>({
  parse: async (input, _command, flag) => {
    return readClientId(input, `--${flag.name}`);
  },
});
