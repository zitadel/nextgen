import { join } from "node:path";

import { ReleaseChannel } from "./upgrade/channel";
import { npmDistTagForCliVersion } from "./public-cli";
import { isCI } from "./skills-hint";
import { telemetryConfigDir } from "./telemetry/identity";

/** The prefix of the Zitadel packages that move together. */
export const ZITADEL_SCOPE = "@zitadel/";

/** The package whose dist-tag names the newest release. */
export const ZITADEL_CLI = "@zitadel/cli";

/** The environment variable that, set to `0`, keeps a run off the npm registry. */
export const UPDATE_CHECK_VARIABLE = "ZITADEL_UPDATE_CHECK";

const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/**
 * Whether a run stays off the registry: asked to, or on CI, where no person
 * reads a notice.
 *
 * @param env - The run's environment.
 */
export function updateCheckDisabled(env: NodeJS.ProcessEnv): boolean {
  return env[UPDATE_CHECK_VARIABLE] === "0" || isCI(env);
}

/**
 * Where the newest Zitadel release is looked up. `npm_config_registry` is where
 * npm and npx themselves were pointed, so a mirror keeps working.
 *
 * @param cliVersion - The running CLI's version, which decides the dist-tag.
 * @param env - The run's environment.
 */
export function zitadelChannel(cliVersion: string, env: NodeJS.ProcessEnv): ReleaseChannel {
  const dir = telemetryConfigDir(env);
  return new ReleaseChannel({
    packageName: ZITADEL_CLI,
    distTag: npmDistTagForCliVersion(cliVersion),
    registry: (env.npm_config_registry?.trim() || DEFAULT_REGISTRY).replace(/\/+$/, ""),
    cacheFile: dir === undefined ? undefined : join(dir, "update-check.json"),
  });
}
