import { npmDistTagForCliVersion } from "@/lib/public-cli";
import { isCI } from "@/lib/skills-hint";

import { DistTagRegistry } from "./dist-tag-registry";
import { LookupCache } from "./lookup-cache";
import { Release } from "./release";
import type { UpgradeTarget } from "./upgrade-target";

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The newest published release on this CLI's dist-tag, asked of the registry at most once a day. */
export class ReleaseChannel {
  /** What is being upgraded. */
  private readonly target: UpgradeTarget;

  /** The run's environment. */
  private readonly env: NodeJS.ProcessEnv;

  /** The dist-tag this CLI's releases are published on. */
  private readonly distTag: string;

  /** The registry asked for the dist-tag. */
  private readonly registry: DistTagRegistry;

  /** Where the last answer is kept. */
  private readonly cache: LookupCache;

  /**
   * @param target - What is being upgraded.
   * @param cliVersion - The running CLI's version, which decides the dist-tag.
   * @param env - The run's environment.
   */
  constructor(target: UpgradeTarget, cliVersion: string, env: NodeJS.ProcessEnv) {
    this.target = target;
    this.env = env;
    this.distTag = npmDistTagForCliVersion(cliVersion);
    this.registry = DistTagRegistry.of(env, target);
    this.cache = LookupCache.of(env);
  }

  /**
   * Whether this run stays off the registry: asked to, or on CI, where no person
   * reads a notice.
   */
  isDisabled(): boolean {
    return this.env[this.target.updateCheckVariable] === "0" || isCI(this.env);
  }

  /**
   * The newest release, from the cache when it is under a day old. Never throws:
   * a lookup is advice, so an offline machine, a registry that does not answer or
   * an unwritable cache costs the answer, not the command.
   *
   * @returns The release, or `undefined` when nobody can say.
   */
  async latest(): Promise<Release | undefined> {
    return this.lookup(false);
  }

  /**
   * The newest release as the registry answers now, past the cache. Never throws.
   *
   * @returns The release, or `undefined` when the registry did not say.
   */
  async latestFresh(): Promise<Release | undefined> {
    return this.lookup(true);
  }

  /**
   * Answers from the cache or the registry, and remembers the answer. A failed
   * lookup is remembered as well, keeping the version known before it, so an
   * offline machine does not wait out the timeout on every run.
   *
   * @param fresh - Skip the cache and return only what the registry answered now.
   */
  private async lookup(fresh: boolean): Promise<Release | undefined> {
    const cached = await this.cache.read(this.distTag, this.registry.url);
    if (!fresh && cached !== undefined && Date.now() - cached.checked_at < CACHE_MAX_AGE_MS) {
      return Release.from(cached.version);
    }
    const answered = await this.registry.version(this.distTag);
    const known = answered ?? cached?.version;
    await this.cache.write({
      checked_at: Date.now(),
      dist_tag: this.distTag,
      registry: this.registry.url,
      ...(known === undefined ? {} : { version: known }),
    });
    return Release.from(fresh ? answered : known);
  }
}
