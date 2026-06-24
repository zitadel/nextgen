import { gzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";

import type { BlobEntry, BlobStore } from "./storage.js";

import { buildPackument } from "./packument.js";

interface InMemoryBlob extends BlobEntry {
  readonly body: Buffer;
}

/**
 * Build a {@link BlobStore} backed by an in-memory list of tarballs.
 *
 * Tests give it a set of pre-built blobs and the store hands them
 * back through {@link BlobStore.list} / {@link BlobStore.read}
 * without touching the filesystem.
 */
const fakeStore = (blobs: readonly InMemoryBlob[]): BlobStore => ({
  put: async () => {
    throw new Error("put is not exercised in tests");
  },
  list: async (prefix) => blobs.filter((blob) => blob.key.startsWith(prefix)),
  read: async (key) => {
    const found = blobs.find((blob) => blob.key === key);
    if (!found) throw new Error(`no blob for key ${key}`);
    return found.body;
  },
});

/**
 * Hand-built minimal POSIX tar+gzip stream containing a single
 * `package/package.json` entry whose body is the given JSON.
 *
 * Avoids pulling tar-stream just for tests by writing the 512-byte
 * USTAR header layout directly; that's all `buildPackument` ever
 * reads from a tarball.
 */
const buildTarball = (manifestJson: Buffer): Buffer => {
  const BLOCK_SIZE = 512;
  const header = Buffer.alloc(BLOCK_SIZE, 0);
  header.write("package/package.json", 0, 100, "ascii");
  header.write("0000644\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(manifestJson.length.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
  header.write(
    Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, "0") + "\0",
    136,
    12,
    "ascii",
  );
  header.write("        ", 148, 8, "ascii");
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");

  const padding = Buffer.alloc((BLOCK_SIZE - (manifestJson.length % BLOCK_SIZE)) % BLOCK_SIZE, 0);
  const trailer = Buffer.alloc(BLOCK_SIZE * 2, 0);
  return gzipSync(Buffer.concat([header, manifestJson, padding, trailer]));
};

const manifestTarball = (manifest: object): Buffer =>
  buildTarball(Buffer.from(JSON.stringify(manifest)));

describe("buildPackument", () => {
  test("returns null when the store has no matching tarballs", async () => {
    const store = fakeStore([]);
    expect(await buildPackument(store, "@foodbar", "alpha")).toBeNull();
  });

  test("builds a packument with the latest dist-tag set to the newest blob", async () => {
    const older = manifestTarball({
      name: "@foodbar/alpha",
      version: "0.0.0-sha-aaaaaaa",
    });
    const newer = manifestTarball({
      name: "@foodbar/alpha",
      version: "0.0.0-sha-bbbbbbb",
    });

    const store = fakeStore([
      {
        key: "@foodbar/alpha/-/older.tgz",
        url: "https://example.test/-/blob/older",
        size: older.length,
        uploadedAt: new Date("2026-06-23T00:00:00Z"),
        body: older,
      },
      {
        key: "@foodbar/alpha/-/newer.tgz",
        url: "https://example.test/-/blob/newer",
        size: newer.length,
        uploadedAt: new Date("2026-06-24T00:00:00Z"),
        body: newer,
      },
    ]);

    const packument = await buildPackument(store, "@foodbar", "alpha");
    expect(packument).not.toBeNull();
    expect(packument?.name).toBe("@foodbar/alpha");
    expect(packument?.["dist-tags"].latest).toBe("0.0.0-sha-bbbbbbb");
    expect(Object.keys(packument?.versions ?? {}).sort()).toEqual([
      "0.0.0-sha-aaaaaaa",
      "0.0.0-sha-bbbbbbb",
    ]);
  });

  test("attaches dist.tarball, shasum, integrity, and unpackedSize to every version", async () => {
    const body = manifestTarball({
      name: "@foodbar/alpha",
      version: "0.0.0-sha-onlyone",
    });
    const store = fakeStore([
      {
        key: "@foodbar/alpha/-/only.tgz",
        url: "https://example.test/-/blob/only",
        size: body.length,
        uploadedAt: new Date("2026-06-24T00:00:00Z"),
        body,
      },
    ]);

    const packument = await buildPackument(store, "@foodbar", "alpha");
    const version = packument?.versions["0.0.0-sha-onlyone"];
    expect(version?.dist.tarball).toBe("https://example.test/-/blob/only");
    expect(version?.dist.shasum).toMatch(/^[0-9a-f]{40}$/);
    expect(version?.dist.integrity).toMatch(/^sha512-/);
    expect(version?.dist.unpackedSize).toBe(body.length);
  });

  test("skips non-tarball blobs that share the package prefix", async () => {
    const body = manifestTarball({
      name: "@foodbar/alpha",
      version: "0.0.0-sha-good",
    });
    const store = fakeStore([
      {
        key: "@foodbar/alpha/-/good.tgz",
        url: "https://example.test/-/blob/good",
        size: body.length,
        uploadedAt: new Date(),
        body,
      },
      {
        key: "@foodbar/alpha/-/junk.txt",
        url: "https://example.test/-/blob/junk",
        size: 0,
        uploadedAt: new Date(),
        body: Buffer.alloc(0),
      },
    ]);
    const packument = await buildPackument(store, "@foodbar", "alpha");
    expect(Object.keys(packument?.versions ?? {})).toEqual(["0.0.0-sha-good"]);
  });
});
