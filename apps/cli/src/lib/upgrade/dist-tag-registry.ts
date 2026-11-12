import semver from "semver";

import type { UpgradeTarget } from "./upgrade-target";

const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const LOOKUP_TIMEOUT_MS = 1500;

/** The npm registry a run asks for the CLI package's dist-tags. */
export class DistTagRegistry {
  /** The registry's address, without a trailing slash. */
  readonly url: string;

  /** What is being upgraded, which says whose dist-tags to read. */
  private readonly target: UpgradeTarget;

  /**
   * @param url - The registry's address, without a trailing slash.
   * @param target - What is being upgraded.
   */
  private constructor(url: string, target: UpgradeTarget) {
    this.url = url;
    this.target = target;
  }

  /**
   * The registry this run was pointed at. `npm_config_registry` is where npm and
   * npx themselves were pointed, so a mirror keeps working and a private
   * registry sees the request npx made.
   *
   * @param env - The run's environment.
   * @param target - What is being upgraded.
   */
  static of(env: NodeJS.ProcessEnv, target: UpgradeTarget): DistTagRegistry {
    const url = (env.npm_config_registry?.trim() || DEFAULT_REGISTRY).replace(/\/+$/, "");
    return new DistTagRegistry(url, target);
  }

  /**
   * Asks for the package's dist-tags alone, far less than its full document.
   *
   * @param distTag - The tag to read.
   * @returns Its version, or `undefined` when the registry did not say or answered anything but a version.
   */
  async version(distTag: string): Promise<string | undefined> {
    try {
      const response = await fetch(`${this.url}${this.target.distTagsPath}`, {
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      });
      if (!response.ok) {
        return undefined;
      }
      const tags = (await response.json()) as Record<string, unknown>;
      const version = tags[distTag];
      return typeof version === "string" && semver.valid(version) !== null ? version : undefined;
    } catch {
      return undefined;
    }
  }
}
