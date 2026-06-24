import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

/**
 * One entry returned by {@link BlobStore.list} or {@link BlobStore.put}.
 *
 * Mirrors the subset of fields the npm registry protocol consumes:
 * a stable lookup key, a public URL the npm client can fetch, the byte
 * size of the underlying file, and the {@link BlobEntry.uploadedAt}
 * timestamp the packument uses to resolve the `latest` dist-tag.
 */
export interface BlobEntry {
  readonly key: string;
  readonly url: string;
  readonly size: number;
  /**
   * When this blob last changed. The filesystem store reports the file's
   * last-modified time (`stat().mtime`); the newest entry wins the
   * `latest` dist-tag. Since each snapshot is written once and never
   * rewritten, modified time and creation time coincide in practice.
   */
  readonly uploadedAt: Date;
}

/**
 * Pluggable storage backend used by every npm-protocol handler.
 *
 * The shape is deliberately minimal so the same store interface fits a
 * local filesystem during development AND the function bundle on
 * Vercel (where each preview deploy ships its own snapshot tarballs).
 */
export interface BlobStore {
  readonly put: (key: string, body: Buffer, contentType: string) => Promise<BlobEntry>;
  readonly list: (prefix: string) => Promise<readonly BlobEntry[]>;
  readonly read: (key: string) => Promise<Buffer>;
}

/**
 * Recursively walk a directory yielding every file path it contains.
 *
 * Returns an empty list if the root does not exist; any other error is
 * re-thrown so genuine I/O failures are not silently swallowed.
 */
const walkDirectory = async (rootDirectory: string): Promise<readonly string[]> => {
  let entries;
  try {
    entries = await readdir(rootDirectory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(rootDirectory, entry.name);
      return entry.isDirectory() ? walkDirectory(fullPath) : ([fullPath] as readonly string[]);
    }),
  );
  return nested.flat();
};

/**
 * Filesystem-backed {@link BlobStore}.
 *
 * @param storageRoot - Directory the store treats as its key space.
 *   Every key written or read is resolved relative to this path.
 * @param publicBase - URL prefix the store advertises in
 *   {@link BlobEntry.url}. Consumers fetch tarballs from
 *   `${publicBase}/-/blob/<key>` which is served by the same Hono app.
 */
export const createFsStore = (storageRoot: string, publicBase: string): BlobStore => {
  const toUrl = (key: string): string => `${publicBase}/-/blob/${encodeURI(key)}`;

  // Defense-in-depth against path traversal: resolve every key against
  // the storage root and refuse anything that lands outside it. The
  // HTTP layer already rejects `..` keys, but the store is the last
  // line so a future caller cannot accidentally read arbitrary files.
  const resolvedRoot = resolve(storageRoot);
  const resolveWithinRoot = (key: string): string => {
    const resolved = resolve(storageRoot, key);
    if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + sep)) {
      throw new Error(`key escapes storage root: ${key}`);
    }
    return resolved;
  };

  return {
    put: async (key, body, _contentType) => {
      const destination = resolveWithinRoot(key);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, body);
      // Report the file's actual on-disk stats so `put()` is consistent
      // with what `list()` returns (mtime, not wall-clock).
      const info = await stat(destination);
      return {
        key,
        url: toUrl(key),
        size: info.size,
        uploadedAt: info.mtime,
      };
    },

    list: async (prefix) => {
      // Only traverse the subtree the prefix points at instead of the
      // whole store: a packument request scopes to `@scope/name/-/`, so
      // walking just that directory keeps each lookup proportional to the
      // package's own files rather than the entire snapshot bundle. The
      // directory portion of the prefix is everything up to the last `/`;
      // an empty/path-less prefix walks the whole root.
      const lastSlash = prefix.lastIndexOf("/");
      const prefixDir = lastSlash === -1 ? "" : prefix.slice(0, lastSlash);
      // The prefix derives from request params, so validate the resolved
      // walk root stays inside the store — a crafted `..` scope/name must
      // not let the traversal escape `storageRoot`. An escaping prefix
      // simply matches nothing.
      let walkRoot: string;
      try {
        walkRoot = prefixDir ? resolveWithinRoot(prefixDir) : storageRoot;
      } catch {
        return [];
      }
      const allFiles = await walkDirectory(walkRoot);
      const matched = await Promise.all(
        allFiles.map(async (fullPath): Promise<BlobEntry | null> => {
          // Blob keys are always POSIX-style (`@scope/name/-/file.tgz`),
          // but the filesystem path uses the platform separator — on
          // Windows that would be `\`, which downstream prefix matching
          // and URL generation do not expect. `path.relative` derives the
          // key independent of any trailing separator on `storageRoot`;
          // normalize the result to forward slashes.
          const key = relative(storageRoot, fullPath).split(sep).join("/");
          if (!key.startsWith(prefix)) return null;
          const info = await stat(fullPath);
          return {
            key,
            url: toUrl(key),
            size: info.size,
            uploadedAt: info.mtime,
          };
        }),
      );
      return matched.filter((entry): entry is BlobEntry => entry !== null);
    },

    read: async (key) => readFile(resolveWithinRoot(key)),
  };
};
