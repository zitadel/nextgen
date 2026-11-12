import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import semver from "semver";

/** A lookup's answer, kept between runs so a command asks the registry at most once a day. */
export type CachedLookup = Readonly<{
  checked_at: number;
  dist_tag: string;
  registry: string;
  version?: string;
}>;

/** The file a lookup's answer is kept in. */
export class LookupCache {
  /** The file answers are kept in, or `undefined` when there is no home to write to. */
  private readonly file: string | undefined;

  private constructor(file: string | undefined) {
    this.file = file;
  }

  /**
   * @param file - Where answers are kept.
   * @returns A cache that remembers nothing when there is no file to write to.
   */
  static at(file: string | undefined): LookupCache {
    return new LookupCache(file);
  }

  /**
   * The answer kept for this dist-tag on this registry; another registry's says
   * nothing about it.
   *
   * @returns The answer, or `undefined` when there is none or it cannot be trusted.
   */
  async read(distTag: string, registry: string): Promise<CachedLookup | undefined> {
    if (this.file === undefined) {
      return undefined;
    }
    try {
      const cached = JSON.parse(await readFile(this.file, "utf8")) as CachedLookup;
      if (
        cached.dist_tag !== distTag ||
        cached.registry !== registry ||
        typeof cached.checked_at !== "number"
      ) {
        return undefined;
      }
      // The version is held to what the registry would have had to answer to get
      // here, because a file is as much an answer from outside as the response
      // was: anything else in it is a cache to ask again rather than a version.
      return cached.version === undefined || semver.valid(cached.version) !== null
        ? cached
        : { ...cached, version: undefined };
    } catch {
      return undefined;
    }
  }

  /** Keeps an answer. A home that cannot be written only means asking again next time. */
  async write(lookup: CachedLookup): Promise<void> {
    if (this.file === undefined) {
      return;
    }
    try {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(this.file, `${JSON.stringify(lookup)}\n`);
    } catch {
      // See above: the cache is an optimisation.
    }
  }
}
