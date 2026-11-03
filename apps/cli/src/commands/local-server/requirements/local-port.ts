import {
  DEFAULT_LOCAL_SERVER_PORT,
  localServerUrl,
  peekRuntimeMetadata,
} from "../../../lib/local-server/runtime";
import { requirement } from "../../../lib/oclif/requirements";
import { resolveCwd } from "../../../lib/paths";

/**
 * The port a local server will be on, as far as is known before one is
 * chosen: the one asked for, else the one this directory already has, else the
 * default. It refuses nothing. The run is then about the server at that port.
 */
export const localPort = requirement({
  resolve: async ({ flags }) => {
    const recorded = await peekRuntimeMetadata(
      resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined),
    );
    return Number(flags.port ?? recorded?.port ?? DEFAULT_LOCAL_SERVER_PORT);
  },
  source: (port) => {
    return localServerUrl(port);
  },
});
