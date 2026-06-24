import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * One entry returned by {@link BlobStore.list} or {@link BlobStore.put}.
 *
 * Mirrors the subset of fields the npm registry protocol consumes:
 * a stable lookup key, a public URL the npm client can fetch, the byte
 * size of the underlying file, and the time the file was created so the
 * packument can resolve the `latest` dist-tag.
 */
export interface BlobEntry {
  readonly key: string;
  readonly url: string;
  readonly size: number;
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

  return {
    put: async (key, body, _contentType) => {
      const destination = join(storageRoot, key);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, body);
      return {
        key,
        url: toUrl(key),
        size: body.length,
        uploadedAt: new Date(),
      };
    },

    list: async (prefix) => {
      const allFiles = await walkDirectory(storageRoot);
      const matched = await Promise.all(
        allFiles.map(async (fullPath): Promise<BlobEntry | null> => {
          const key = fullPath.slice(storageRoot.length + 1);
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

    read: async (key) => readFile(join(storageRoot, key)),
  };
};
