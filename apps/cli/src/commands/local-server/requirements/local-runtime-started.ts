import { readNearestRuntimeMetadata } from "../../../lib/local-server/runtime";
import { requirement } from "../../../lib/oclif/requirements";
import { resolveCwd } from "../../../lib/paths";

/**
 * The server `zitadel start` ran in this directory or the nearest parent, as
 * `doctor` and `console` find it. Refuses a directory where none was started.
 * The run is then about that server.
 */
export const localRuntimeStarted = requirement({
  refusal: {
    message: "Local Zitadel runtime has not been started",
    hint: "Run `zitadel start` first.",
    next: ["start"],
  },
  resolve: async ({ flags }) => {
    return readNearestRuntimeMetadata(
      resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined),
    );
  },
  source: (nearest) => {
    return nearest.runtime.server_url;
  },
});
