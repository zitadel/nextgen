import { ApiError } from "@zitadel/api/runtime/fetch";

import { ZitadelError } from "../../../../lib/errors";
import { requirement } from "../../../../lib/oclif/requirements";
import { inShell } from "../../../../lib/suggestion";

/**
 * Refuses a plain preview value for a name whose primary value is a secret: it
 * holds a credential, so its preview value is one too, and stored plain it
 * would be readable and a preview deploy would freeze it in the clear. A token
 * that may not read the primary values leaves the check to whoever can; any
 * other failure leaves the classification unknown, and writing on an unknown is
 * the one outcome this guard exists to prevent.
 *
 * The suggestion is built here because it must carry the run's selector before
 * the stdin redirection, which a refusal's `next` cannot place.
 */
export const previewSecret = requirement<{ readonly checked: boolean }>({
  resolve: async ({ args, flags, connect, suggest }) => {
    if (flags.preview !== true || flags.secret === true) {
      return {
        checked: false,
      };
    }
    const name = String(args.name);
    const { client, projectId } = await connect();
    const held = await client
      .getVariables({ project_id: projectId, kind: "primary" })
      .then((body) => {
        return body[name]?.primary;
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 403) {
          return undefined;
        }
        throw error;
      });
    if (typeof held === "object" && held !== null) {
      throw new ZitadelError(
        "E_VALIDATION",
        `${name} is a secret, so its preview value must be one too.`,
        {
          hint: "Set the preview value with --secret, piped in or prompted for.",
          nextCommands: [
            inShell(suggest(`variable set ${name} --secret --preview`), {
              after: " < value.txt",
            }),
          ],
        },
      );
    }
    return {
      checked: true,
    };
  },
});
