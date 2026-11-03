import { requirement } from "../../../../lib/oclif/requirements";
import { resolveServer } from "../../../../lib/server";

/** The server `--server` named, or none when it was not given. */
type GivenServer = {
  readonly value: string | undefined;
};

/**
 * The server `--server` named, resolved as every command resolves one: an
 * http(s) URL, as its origin. A server that is not given is left to a prompt.
 */
export const givenServer = requirement<GivenServer>({
  resolve: async ({ meta }) => {
    if (!meta.serverFlag) {
      return {
        value: undefined,
      };
    }
    const server = await resolveServer({
      cwd: meta.cwd,
      serverFlag: meta.serverFlag,
    });
    return {
      value: server.value,
    };
  },
});
