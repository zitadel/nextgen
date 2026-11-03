import semver from "semver";

import { Cmd } from "../../../lib/cmd";
import { readNearestRuntimeMetadata } from "../../../lib/local-server/runtime";
import { LocalServer } from "../../../lib/local-server/server";
import { requirement, unmet } from "../../../lib/oclif/requirements";
import { hasZitadelConfig } from "../../../lib/project";
import { retryOptionsOf, setupRetryFlags } from "../retry";

/**
 * Refuses a local server that another CLI release started. `start` restarts
 * such a server, but one left running stays that release's until `start` runs
 * again, and its API is that release's: setup would create the project, then
 * fail uploading the default schema and flow, and `--force` would not help.
 *
 * Only a binary runtime records the version it runs, and only release versions
 * are compared: an override records `override`, which says nothing about its
 * API. An unreadable `runtime.json` is doctor's to report, not setup's.
 */
export const localServerVersion = requirement({
  refusal: {
    code: "E_CONFLICT",
    message: "The local Zitadel server runs {running}, but this CLI ships {expected}",
    hint:
      "A server another CLI release started serves that release's API, so setup would stop " +
      "halfway. Run start to restart it on {expected}; its data stays. {where}" +
      "Then rerun setup.",
    next: ["{start}", "{setup}"],
    details: {
      server_url: "{serverUrl}",
      server_version: "{running}",
      cli_server_version: "{expected}",
    },
  },
  resolve: async ({ flags, meta }) => {
    if (await hasZitadelConfig(meta.cwd)) {
      return true as const;
    }
    const nearest = await readNearestRuntimeMetadata(meta.cwd).catch(() => undefined);
    const runtime = nearest?.runtime;
    if (!nearest || runtime?.backend !== "binary" || runtime.server_url !== meta.source) {
      return true as const;
    }
    const expected = LocalServer.bundledVersion();
    if (
      expected === undefined ||
      !semver.valid(expected) ||
      !semver.valid(runtime.server_version) ||
      runtime.server_version === expected
    ) {
      return true as const;
    }
    return unmet({
      running: runtime.server_version,
      expected,
      serverUrl: runtime.server_url,
      start: nearest.dir === meta.cwd ? "start" : `start ${Cmd.option("--cwd", nearest.dir)}`,
      where:
        nearest.dir === meta.cwd
          ? ""
          : `Run start in ${nearest.dir}, where the server was started. `,
      setup: `setup ${setupRetryFlags({ ...retryOptionsOf(flags), cwd: undefined })}`,
    });
  },
});
