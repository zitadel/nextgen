import { join } from "node:path";

import { isCI } from "@/lib/ci";
import { npmDistTagForCliVersion } from "@/lib/public-cli";
import { telemetryConfigDir } from "@/lib/telemetry/identity";

import { Cache } from "./cache";
import { ReleaseChannel } from "./channel";
import { UPDATE_CHECK_VARIABLE, ZITADEL_CLI } from "./defaults";

/**
 * The registry asked when npm was not pointed at another.
 */
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/**
 * Whether a run stays off the registry: asked to with the environment variable,
 * or running on CI, where no person reads a notice about a newer release.
 *
 * @param env - The run's environment.
 * @returns `true` when the registry must not be asked.
 */
export function updateCheckDisabled(env: NodeJS.ProcessEnv): boolean {
  if (env[UPDATE_CHECK_VARIABLE] === "0") {
    return true;
  }
  return isCI(env);
}

/**
 * Builds the channel that looks the newest Zitadel release up. It asks the
 * registry that npm and npx themselves were pointed at, through
 * `npm_config_registry`, so a mirror keeps working and a private registry sees
 * the request npx made. Its answer is kept in the CLI's config directory, next to
 * the telemetry identity.
 *
 * @param cliVersion - The running CLI's version, which decides the dist-tag.
 * @param env - The run's environment.
 * @returns The channel.
 */
export function releaseChannel(cliVersion: string, env: NodeJS.ProcessEnv): ReleaseChannel {
  let registry = DEFAULT_REGISTRY;
  const configured = env.npm_config_registry?.trim();
  if (configured !== undefined && configured !== "") {
    registry = configured.replace(/\/+$/, "");
  }

  let file: string | undefined;
  const directory = telemetryConfigDir(env);
  if (directory !== undefined) {
    file = join(directory, "update-check.json");
  }

  return new ReleaseChannel({
    packageName: ZITADEL_CLI,
    distTag: npmDistTagForCliVersion(cliVersion),
    registry,
    cache: new Cache(file),
  });
}
