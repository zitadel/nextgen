import { join } from "node:path";

import { npmDistTagForCliVersion } from "@/lib/public-cli";
import { isCI } from "@/lib/skills-hint";
import { telemetryConfigDir } from "@/lib/telemetry/identity";
import { DistTagRegistry, LookupCache, ReleaseChannel } from "@/lib/upgrade";

import { UPDATE_CHECK_VARIABLE, ZITADEL } from "./zitadel";

/** The newest Zitadel release on this CLI's dist-tag, kept in the CLI's config directory. */
export class ZitadelReleaseChannel extends ReleaseChannel {
  /** The run's environment. */
  private readonly env: NodeJS.ProcessEnv;

  /**
   * @param cliVersion - The running CLI's version, which decides the dist-tag.
   * @param env - The run's environment.
   */
  constructor(cliVersion: string, env: NodeJS.ProcessEnv) {
    const dir = telemetryConfigDir(env);
    super(
      npmDistTagForCliVersion(cliVersion),
      DistTagRegistry.of(env, ZITADEL),
      LookupCache.at(dir === undefined ? undefined : join(dir, "update-check.json")),
    );
    this.env = env;
  }

  /**
   * Whether this run stays off the registry: asked to, or on CI, where no person
   * reads a notice.
   */
  isDisabled(): boolean {
    return this.env[UPDATE_CHECK_VARIABLE] === "0" || isCI(this.env);
  }
}
