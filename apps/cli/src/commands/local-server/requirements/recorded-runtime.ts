import { DEFAULT_LOCAL_SERVER_URL, readRuntimeMetadata } from "../../../lib/local-server/runtime";
import { requirement } from "../../../lib/oclif/requirements";

/**
 * The server `zitadel start` recorded in this directory, if there is one. A
 * directory with no server is not refused: a command that stops or resets it
 * reports that there is nothing to do. The run is about that server, or about
 * the default local one.
 */
export const recordedRuntime = requirement({
  resolve: async ({ meta }) => {
    return {
      runtime: await readRuntimeMetadata(meta.cwd),
    };
  },
  source: ({ runtime }) => {
    return runtime?.server_url ?? DEFAULT_LOCAL_SERVER_URL;
  },
});
