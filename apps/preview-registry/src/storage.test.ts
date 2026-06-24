import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createFsStore } from "./storage.js";

describe("createFsStore", () => {
  let storeRoot: string;
  let publicBase: string;

  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), "storage-test-"));
    publicBase = "https://example.test";
  });

  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  test("put writes the body to disk under the given key", async () => {
    const store = createFsStore(storeRoot, publicBase);
    const entry = await store.put(
      "@foodbar/alpha/-/foodbar-alpha-1.tgz",
      Buffer.from("tarball-bytes"),
      "application/octet-stream",
    );
    expect(entry.key).toBe("@foodbar/alpha/-/foodbar-alpha-1.tgz");
    expect(entry.size).toBe("tarball-bytes".length);
    const roundTrip = await store.read("@foodbar/alpha/-/foodbar-alpha-1.tgz");
    expect(roundTrip.toString("utf8")).toBe("tarball-bytes");
  });

  test("put returns a URL prefixed with the configured public base", async () => {
    const store = createFsStore(storeRoot, publicBase);
    const entry = await store.put(
      "@scope/name/-/scope-name-1.tgz",
      Buffer.from("x"),
      "application/octet-stream",
    );
    expect(entry.url).toBe("https://example.test/-/blob/@scope/name/-/scope-name-1.tgz");
  });

  test("list returns every entry whose key matches the prefix", async () => {
    const store = createFsStore(storeRoot, publicBase);
    await store.put("@scope-a/x/-/a-x.tgz", Buffer.from("1"), "application/octet-stream");
    await store.put("@scope-a/y/-/a-y.tgz", Buffer.from("22"), "application/octet-stream");
    await store.put("@scope-b/z/-/b-z.tgz", Buffer.from("333"), "application/octet-stream");
    const inA = await store.list("@scope-a/");
    expect(inA.map((entry) => entry.key).sort()).toEqual([
      "@scope-a/x/-/a-x.tgz",
      "@scope-a/y/-/a-y.tgz",
    ]);
    const all = await store.list("");
    expect(all).toHaveLength(3);
  });

  test("list on a missing directory returns an empty array", async () => {
    const missingRoot = join(storeRoot, "does-not-exist");
    const store = createFsStore(missingRoot, publicBase);
    expect(await store.list("")).toEqual([]);
  });

  test("read throws when the requested key does not exist", async () => {
    const store = createFsStore(storeRoot, publicBase);
    await expect(store.read("missing/file.tgz")).rejects.toThrow();
  });
});
