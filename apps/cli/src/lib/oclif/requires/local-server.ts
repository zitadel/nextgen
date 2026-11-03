import { resolveCwd } from "../../paths";
import {
  DEFAULT_LOCAL_SERVER_PORT,
  localServerUrl,
  peekRuntimeMetadata,
  readNearestRuntimeMetadata,
} from "../../local-server/runtime";
import { requirement } from "../requirements";

/**
 * The server `zitadel start` ran in this directory or the nearest parent, as
 * `doctor` and `console` find it. The run is then about that server.
 */
export const localRuntimeStarted = requirement({
  refusal: {
    message: "Local Zitadel runtime has not been started",
    hint: "Run `zitadel start` first.",
    next: ["start"],
  },
  resolve: ({ flags }) =>
    readNearestRuntimeMetadata(resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined)),
  source: (nearest) => nearest.runtime.server_url,
});

/**
 * The port a local server will be on, as far as is known before one is
 * chosen: the one asked for, else the one this directory already has, else the
 * default. The run is then about the server at that port.
 */
export const localPort = requirement({
  resolve: async ({ flags }) => {
    const recorded = await peekRuntimeMetadata(
      resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined),
    );
    return Number(flags.port ?? recorded?.port ?? DEFAULT_LOCAL_SERVER_PORT);
  },
  source: (port) => localServerUrl(port),
});
