import type { Cache, CacheEntry } from "./cache";
import { Release } from "./release";

/**
 * How long the registry is left alone after it has answered, so a command that
 * only wants to mention a newer release never costs a network round trip on
 * every run.
 */
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * How long a lookup that found nothing is remembered, much shorter than an
 * answer, so one failed request does not hide a release for a day.
 */
const FAILURE_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * How long a lookup may take. It is advice, so it must never hold up the command
 * that asked.
 */
const LOOKUP_TIMEOUT_MS = 1500;

/**
 * What a {@link ReleaseChannel} is given.
 */
export type ChannelOptions = Readonly<{
  /**
   * The package whose dist-tag names the newest release, such as `@acme/cli`.
   */
  packageName: string;

  /**
   * The dist-tag the releases are published on.
   */
  distTag: string;

  /**
   * The registry to ask, without a trailing slash.
   */
  registry: string;

  /**
   * Where the last answer is kept.
   */
  cache: Cache;
}>;

/**
 * The newest published release on one dist-tag, asked of the registry at most
 * once a day, and at most once an hour after a lookup that failed.
 */
export class ReleaseChannel {
  /**
   * What the channel was given.
   */
  private readonly options: ChannelOptions;

  /**
   * @param options.packageName - The package whose dist-tag names the newest release.
   * @param options.distTag - The dist-tag the releases are published on.
   * @param options.registry - The registry to ask, without a trailing slash.
   * @param options.cache - Where the last answer is kept.
   */
  constructor(options: ChannelOptions) {
    this.options = options;
  }

  /**
   * Looks the newest release up, from the cache when its answer is under a day
   * old, and from the registry otherwise.
   *
   * It never throws: a lookup is advice, so an offline machine, a registry that
   * does not answer or an unwritable cache costs the answer and never the
   * caller. A failed lookup is remembered as well, for an hour and not a day,
   * keeping the version known before it, so an offline machine does not wait out
   * the timeout on every run and one failed request does not hide a release for
   * a day.
   *
   * A cached timestamp ahead of now (the clock moved back, or the file was
   * edited) would otherwise keep its answer fresh for however long it says, so
   * it counts as stale. A version the cache held is held to the same standard as
   * one the registry sent, because a file is as much an answer from outside, so
   * junk in it is neither returned nor written back. A fresh lookup that fails
   * leaves the cache as it was, so it neither hides the failure nor makes an
   * old answer look current.
   *
   * The registry is asked for the package's dist-tags alone, which is far less
   * than its full document.
   *
   * @param options.fresh - Skip the cache and return only what the registry answered now.
   * @returns The release, or `undefined` when nobody can say.
   */
  async latest(options: { fresh?: boolean } = {}): Promise<Release | undefined> {
    const { fresh = false } = options;
    const { packageName, distTag, registry, cache } = this.options;
    const key = `${registry}/${packageName}#${distTag}`;
    const cached = await cache.get(key);

    if (!fresh && cached !== undefined) {
      const age = Date.now() - cached.checked_at;
      const window = cached.failed === true ? FAILURE_MAX_AGE_MS : CACHE_MAX_AGE_MS;
      if (age >= 0 && age < window) {
        return Release.from(cached.version);
      }
    }

    const path = `/-/package/${packageName.replaceAll("/", "%2f")}/dist-tags`;
    const answered = await fetch(`${registry}${path}`, {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    })
      .then(async (response) => {
        if (!response.ok) {
          return {};
        }
        return (await response.json()) as Record<string, unknown>;
      })
      .then((tags) => {
        return Release.from(tags[distTag]);
      })
      .catch(() => {
        return undefined;
      });

    if (fresh && answered === undefined) {
      return undefined;
    }

    const known = answered ?? Release.from(cached?.version);
    const entry: CacheEntry = {
      checked_at: Date.now(),
      version: known?.version,
      failed: answered === undefined,
    };
    await cache.set(key, entry);

    return known;
  }
}
