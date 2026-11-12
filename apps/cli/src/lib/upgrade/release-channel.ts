import type { DistTagRegistry } from "./dist-tag-registry";
import type { LookupCache } from "./lookup-cache";
import { Release } from "./release";

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The newest published release on one dist-tag, asked of the registry at most once a day. */
export class ReleaseChannel {
  /** The dist-tag the releases are published on. */
  private readonly distTag: string;

  /** The registry asked for the dist-tag. */
  private readonly registry: DistTagRegistry;

  /** Where the last answer is kept. */
  private readonly cache: LookupCache;

  /**
   * @param distTag - The dist-tag the releases are published on.
   * @param registry - The registry to ask.
   * @param cache - Where answers are kept between runs.
   */
  constructor(distTag: string, registry: DistTagRegistry, cache: LookupCache) {
    this.distTag = distTag;
    this.registry = registry;
    this.cache = cache;
  }

  /**
   * The newest release, from the cache when it is under a day old. Never throws:
   * a lookup is advice, so an offline machine, a registry that does not answer or
   * an unwritable cache costs the answer, not the caller.
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
