import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * One remembered answer, kept so a caller can tell how old it is and what it said
 * without asking again.
 */
export type CacheEntry = Readonly<{
  /**
   * When the answer was asked for, in milliseconds since the epoch. A caller
   * judges the entry's age from it.
   */
  checked_at: number;

  /**
   * What the answer was. Absent when the asking failed: a failure is remembered
   * as well, so an offline machine does not ask again on every run.
   */
  version?: string | undefined;
}>;

/**
 * A small key-value cache kept in one JSON file, so an answer outlives the run
 * that asked for it. It is a class of its own, rather than a few functions in
 * its caller, so a caller takes it as a collaborator and a test hands it a
 * temporary file, or no file at all.
 */
export class Cache {
  /**
   * The file entries are kept in, or `undefined` when there is nowhere to keep
   * them.
   */
  private readonly file: string | undefined;

  /**
   * @param file - Where entries are kept. Without one the cache remembers nothing.
   */
  constructor(file: string | undefined) {
    this.file = file;
  }

  /**
   * Looks an answer up. The file is as much an answer from outside as a network
   * response is, so an entry without a timestamp is treated as absent.
   *
   * @param key - What the answer is for.
   * @returns The entry, or `undefined` when there is none or it cannot be trusted.
   */
  async get(key: string): Promise<CacheEntry | undefined> {
    const entries = await this.read();
    const entry = entries[key];
    if (entry === undefined || typeof entry.checked_at !== "number") {
      return undefined;
    }
    return entry;
  }

  /**
   * Keeps an answer next to the others in the file. The cache is only an
   * optimisation, so a home that cannot be written costs one more question next
   * time and is never an error.
   *
   * @param key - What the answer is for.
   * @param entry - The answer.
   */
  async set(key: string, entry: CacheEntry): Promise<void> {
    if (this.file === undefined) {
      return;
    }
    try {
      const entries = await this.read();
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(this.file, `${JSON.stringify({ ...entries, [key]: entry })}\n`);
    } catch {
      return;
    }
  }

  /**
   * Reads every entry in the file. A missing file, text that is not JSON and
   * JSON that is not an object all mean the same thing: nothing is remembered.
   *
   * @returns The entries by key, or none.
   */
  private async read(): Promise<Record<string, CacheEntry | undefined>> {
    if (this.file === undefined) {
      return {};
    }
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, "utf8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {};
      }
      return parsed as Record<string, CacheEntry | undefined>;
    } catch {
      return {};
    }
  }
}
