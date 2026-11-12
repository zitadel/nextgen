import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** One remembered answer: when it was asked, and what the answer was. */
export type CacheEntry = Readonly<{ checked_at: number; version?: string }>;

/** A small key-value cache kept in one JSON file, so an answer outlives the run that asked. */
export class Cache {
  /** The file entries are kept in, or `undefined` when there is nowhere to keep them. */
  private readonly file: string | undefined;

  /**
   * @param file - Where entries are kept; without one the cache remembers nothing.
   */
  constructor(file: string | undefined) {
    this.file = file;
  }

  /**
   * @param key - What the answer is for.
   * @returns The entry, or `undefined` when there is none or the file cannot be trusted.
   */
  async get(key: string): Promise<CacheEntry | undefined> {
    const entry = (await this.read())[key];
    return typeof entry?.checked_at === "number" ? entry : undefined;
  }

  /**
   * Keeps an entry. A home that cannot be written only means asking again next time.
   *
   * @param key - What the answer is for.
   * @param entry - The answer.
   */
  async set(key: string, entry: CacheEntry): Promise<void> {
    if (this.file === undefined) {
      return;
    }
    try {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(this.file, `${JSON.stringify({ ...(await this.read()), [key]: entry })}\n`);
    } catch {
      // The cache is an optimisation.
    }
  }

  /** Every entry in the file, or none when it is missing or is not an object. */
  private async read(): Promise<Record<string, CacheEntry | undefined>> {
    if (this.file === undefined) {
      return {};
    }
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, "utf8"));
      const isMap = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
      return isMap ? (parsed as Record<string, CacheEntry | undefined>) : {};
    } catch {
      return {};
    }
  }
}
