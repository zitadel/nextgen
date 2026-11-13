import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
 * Whether a value read from the file is an entry. The file is as much an answer
 * from outside as a network response is, so nothing in it is trusted: a `null`,
 * a scalar or an object without a timestamp, such as a key left behind by the
 * flat format an older release wrote, is not an entry.
 *
 * @param value - Anything the file held under a key.
 * @returns `true` when it is an entry.
 */
function isEntry(value: unknown): value is CacheEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return typeof (value as { checked_at?: unknown }).checked_at === "number";
}

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
   * What the file held when it was first read, and every key kept since, so one
   * run reads the file once and concurrent keeps in it build on each other.
   */
  private entries: Promise<Record<string, CacheEntry>> | undefined;

  /**
   * The write in flight, so the next one waits for it.
   */
  private writing: Promise<void> = Promise.resolve();

  /**
   * @param file - Where entries are kept. Without one the cache remembers nothing.
   */
  constructor(file: string | undefined) {
    this.file = file;
  }

  /**
   * Looks an answer up. Only entries that pass {@link isEntry} are ever
   * returned, so a caller never has to guard against a corrupt file.
   *
   * @param key - What the answer is for.
   * @returns The entry, or `undefined` when there is none or it cannot be trusted.
   */
  async get(key: string): Promise<CacheEntry | undefined> {
    const entries = await this.load();
    return entries[key];
  }

  /**
   * Keeps an answer next to the others in the file. The cache is only an
   * optimisation, so a home that cannot be written costs one more question next
   * time and is never an error.
   *
   * The file is written to a temporary name and renamed over the real one, so a
   * run that reads while another writes sees the old file or the new one and
   * never half of either. Writes from one cache happen one after another, each
   * of the whole remembered state, so none of them loses another's key or lands
   * out of order. Two runs that write at the same moment can still lose one
   * entry, which only costs that lookup being asked again. Entries that are not
   * valid are left out of the rewrite, so keys from an older format disappear
   * the first time anything is kept.
   *
   * @param key - What the answer is for.
   * @param entry - The answer.
   */
  async set(key: string, entry: CacheEntry): Promise<void> {
    if (this.file === undefined) {
      return;
    }
    this.entries = this.load().then((entries) => {
      return { ...entries, [key]: entry };
    });
    this.writing = this.writing.then(() => {
      return this.persist(this.file);
    });
    await this.writing;
  }

  /**
   * Writes the remembered state to the file, and never throws.
   *
   * @param file - Where entries are kept.
   */
  private async persist(file: string | undefined): Promise<void> {
    if (file === undefined) {
      return;
    }
    try {
      const entries = await this.load();
      const temporary = `${file}.${process.pid}.tmp`;
      await mkdir(dirname(file), { recursive: true });
      await writeFile(temporary, `${JSON.stringify(entries)}\n`);
      await rename(temporary, file);
    } catch {
      return;
    }
  }

  /**
   * The entries, read from the file the first time and remembered after.
   *
   * @returns The entries by key, or none.
   */
  private load(): Promise<Record<string, CacheEntry>> {
    this.entries ??= this.read();
    return this.entries;
  }

  /**
   * Reads every valid entry in the file. A missing file, text that is not JSON
   * and JSON that is not an object all mean the same thing: nothing is
   * remembered. Values that are not entries are dropped.
   *
   * @returns The entries by key, or none.
   */
  private async read(): Promise<Record<string, CacheEntry>> {
    if (this.file === undefined) {
      return {};
    }
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, "utf8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {};
      }
      const entries: Record<string, CacheEntry> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (isEntry(value)) {
          entries[key] = value;
        }
      }
      return entries;
    } catch {
      return {};
    }
  }
}
