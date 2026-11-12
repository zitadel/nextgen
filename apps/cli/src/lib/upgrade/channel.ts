import type { Cache } from "./cache";
import { Release } from "./release";

const LOOKUP_TIMEOUT_MS = 1500;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** What a {@link ReleaseChannel} is given. */
export type ChannelOptions = Readonly<{
  /** The package whose dist-tag names the newest release, such as `@acme/cli`. */
  packageName: string;
  /** The dist-tag the releases are published on. */
  distTag: string;
  /** The registry to ask, without a trailing slash. */
  registry: string;
  /** Where the last answer is kept. */
  cache: Cache;
}>;

/** The newest published release on one dist-tag, asked of the registry at most once a day. */
export class ReleaseChannel {
  /** What the channel was given. */
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
   * The newest release, from the cache when it is under a day old. Never throws:
   * a lookup is advice, so an offline machine costs the answer, not the caller.
   *
   * A failed lookup is remembered as well, keeping the version known before it, so
   * an offline machine does not wait out the timeout on every run.
   *
   * @param options.fresh - Skip the cache and return only what the registry answered now.
   * @returns The release, or `undefined` when nobody can say.
   */
  async latest(options: { fresh?: boolean } = {}): Promise<Release | undefined> {
    const { packageName, distTag, registry, cache } = this.options;
    const key = `${registry}/${packageName}#${distTag}`;
    const cached = await cache.get(key);
    // A timestamp ahead of now (the clock moved back, or the file was edited) is
    // no answer to trust for however long it says, so it is asked again.
    const age = Date.now() - (cached?.checked_at ?? 0);
    if (!options.fresh && cached !== undefined && age >= 0 && age < CACHE_MAX_AGE_MS) {
      return Release.from(cached.version);
    }
    // The dist-tags alone, far less than the package's full document.
    const answered = await fetch(
      `${registry}/-/package/${packageName.replace("/", "%2f")}/dist-tags`,
      {
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      },
    )
      .then(async (response) => {
        return response.ok ? ((await response.json()) as Record<string, unknown>) : {};
      })
      .then((tags) => {
        return Release.from(tags[distTag]);
      })
      .catch(() => {
        return undefined;
      });
    // What the cache held is an answer from outside too, so junk in it is not kept.
    const known = answered?.version ?? Release.from(cached?.version)?.version;
    await cache.set(key, {
      checked_at: Date.now(),
      ...(known === undefined ? {} : { version: known }),
    });
    return options.fresh ? answered : Release.from(known);
  }
}
