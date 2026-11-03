import { toZitadelError } from "../../../lib/errors";
import { requirement, unmet } from "../../../lib/oclif/requirements";
import { resolveServer } from "../../../lib/server";
import { retryOptionsOf, setupRetryFlags, ssoRecovery } from "../retry";

/**
 * The server setup is about, from `--server` or the cloud default. Refuses
 * `--server local` with nothing running, and says how to start it and how to
 * rerun setup against it once it is.
 */
export const server = requirement({
  refusal: {
    code: "E_LOCAL_SERVER_NOT_RUNNING",
    message: "Local Zitadel server is not running",
    hint:
      "{reason}Start local Zitadel first, then rerun setup. {scripting}{recovery}" +
      "After setup succeeds, follow its next_commands to start the app and verify registration, logout, and login in the browser.",
    next: ["start", "{setup}"],
  },
  resolve: async ({ flags, meta }) => {
    try {
      return await resolveServer({
        cwd: meta.cwd,
        serverFlag: meta.serverFlag,
      });
    } catch (error) {
      const normalized = toZitadelError(error);
      if (normalized.code !== "E_LOCAL_SERVER_NOT_RUNNING") {
        throw error;
      }
      const retry = retryOptionsOf(flags);
      const recovery = ssoRecovery(retry, meta.cliVersion);
      return unmet({
        reason: normalized.hint ? `${normalized.hint} ` : "",
        scripting:
          retry.sso && retry.sso.length > 0
            ? "The rerun asks for the client id and secret, because a command carries neither. " +
              "To script it instead, add --sso-client-id and --non-interactive, and pipe the secret in. "
            : "",
        recovery:
          recovery.commands.length > 0
            ? `${recovery.hint}${recovery.commands.map((command) => `\`${command}\``).join(" ")} `
            : recovery.hint,
        setup: `setup ${setupRetryFlags({ ...retry, cwd: undefined })}`,
      });
    }
  },
  source: (server) => {
    return server.value;
  },
});
