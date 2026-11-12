import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import semver from "semver";

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
  /** Where the last answer is kept, or `undefined` when there is nowhere to keep it. */
  cacheFile: string | undefined;
}>;

/** A lookup's answer, kept between runs so the registry is asked at most once a day. */
type Cached = Readonly<{
  checked_at: number;
  dist_tag: string;
  registry: string;
  version?: string;
}>;

/** The newest published release on one dist-tag, asked of the registry at most once a day. */
export class ReleaseChannel {
  /** What the channel was given. */
  private readonly options: ChannelOptions;

  /**
   * @param options.packageName - The package whose dist-tag names the newest release.
   * @param options.distTag - The dist-tag the releases are published on.
   * @param options.registry - The registry to ask, without a trailing slash.
   * @param options.cacheFile - Where the last answer is kept.
   */
  constructor(options: ChannelOptions) {
    this.options = options;
  }

  /**
   * The newest release, from the cache when it is under a day old. Never throws:
   * a lookup is advice, so an offline machine costs the answer, not the caller.
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
    const cached = await this.readCache();
    if (!fresh && cached !== undefined) {
      // A timestamp ahead of now (the clock moved back, or the file was edited) is
      // no answer to trust for however long it says, so it is asked again.
      const age = Date.now() - cached.checked_at;
      if (age >= 0 && age < CACHE_MAX_AGE_MS) {
        return Release.from(cached.version);
      }
    }
    const answered = await this.fetchVersion();
    const known = answered ?? cached?.version;
    await this.writeCache({
      checked_at: Date.now(),
      dist_tag: this.options.distTag,
      registry: this.options.registry,
      ...(known === undefined ? {} : { version: known }),
    });
    return Release.from(fresh ? answered : known);
  }

  /** Asks the registry for the package's dist-tags alone, far less than its full document. */
  private async fetchVersion(): Promise<string | undefined> {
    const { packageName, distTag, registry } = this.options;
    try {
      const path = `/-/package/${packageName.replace("/", "%2f")}/dist-tags`;
      const response = await fetch(`${registry}${path}`, {
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

  /** The answer kept for this dist-tag on this registry; another registry's says nothing about it. */
  private async readCache(): Promise<Cached | undefined> {
    const { cacheFile, distTag, registry } = this.options;
    if (cacheFile === undefined) {
      return undefined;
    }
    try {
      const cached = JSON.parse(await readFile(cacheFile, "utf8")) as Cached;
      if (
        cached.dist_tag !== distTag ||
        cached.registry !== registry ||
        typeof cached.checked_at !== "number"
      ) {
        return undefined;
      }
      // A file is as much an answer from outside as the response was, so its
      // version is held to what the registry would have had to answer.
      return cached.version === undefined || semver.valid(cached.version) !== null
        ? cached
        : { ...cached, version: undefined };
    } catch {
      return undefined;
    }
  }

  /** Keeps an answer. A home that cannot be written only means asking again next time. */
  private async writeCache(lookup: Cached): Promise<void> {
    const { cacheFile } = this.options;
    if (cacheFile === undefined) {
      return;
    }
    try {
      await mkdir(dirname(cacheFile), { recursive: true });
      await writeFile(cacheFile, `${JSON.stringify(lookup)}\n`);
    } catch {
      // The cache is an optimisation.
    }
  }
}
