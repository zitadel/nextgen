import { Flags } from "@oclif/core";
import { type ClientId, parseClientId, validated } from "@zitadel/config/idp";

import { refuseBlank } from "../flags";

/**
 * A client id flag: refused when blank, and handed to the command trimmed, as
 * the client id a prompt would have accepted.
 */
export const clientIdFlag = Flags.custom<ClientId>({
  parse: async (input, _command, flag) =>
    validated(parseClientId(refuseBlank(input, `--${flag.name}`, "the value is empty"))),
});
