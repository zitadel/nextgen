import { describe, expect, test } from "vitest";

import type { BlobEntry, BlobStore } from "./storage.js";

import { createApp } from "./app.js";

/**
 * Minimal in-memory {@link BlobStore} that records every key passed to
 * {@link BlobStore.read}, so tests can assert the route guard rejected a
 * traversal key BEFORE it ever reached the store.
 */
const recordingStore = (): { store: BlobStore; reads: string[] } => {
  const reads: string[] = [];
  const store: BlobStore = {
    put: async () => {
      throw new Error("put is not exercised in tests");
    },
    list: async (): Promise<readonly BlobEntry[]> => [],
    read: async (key) => {
      reads.push(key);
      return Buffer.from("tarball-bytes");
    },
  };
  return { store, reads };
};

describe("createApp blob route", () => {
  test("serves a legitimate tarball key", async () => {
    const { store, reads } = recordingStore();
    const app = createApp(store);
    const response = await app.request("/-/blob/@scope/name/-/scope-name-1.tgz");
    expect(response.status).toBe(200);
    expect(reads).toEqual(["@scope/name/-/scope-name-1.tgz"]);
  });

  test("rejects encoded `..` traversal keys with 404 before reading", async () => {
    const { store, reads } = recordingStore();
    const app = createApp(store);
    const response = await app.request("/-/blob/%2e%2e%2fpackage.json");
    expect(response.status).toBe(404);
    expect(reads).toEqual([]);
  });

  test("rejects nested traversal keys with 404 before reading", async () => {
    const { store, reads } = recordingStore();
    const app = createApp(store);
    const response = await app.request("/-/blob/@scope/name/-/..%2f..%2f..%2fetc%2fpasswd");
    expect(response.status).toBe(404);
    expect(reads).toEqual([]);
  });

  test("returns 404 for malformed percent-encoding instead of 500", async () => {
    const { store, reads } = recordingStore();
    const app = createApp(store);
    const response = await app.request("/-/blob/%E0%A4%A");
    expect(response.status).toBe(404);
    expect(reads).toEqual([]);
  });

  test("answers /-/ping for health checks", async () => {
    const { store } = recordingStore();
    const app = createApp(store);
    const response = await app.request("/-/ping");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
  });

  test("scoped packument route returns 404 when the package has no snapshots", async () => {
    const { store } = recordingStore();
    const app = createApp(store);
    const response = await app.request("/@scope/name");
    expect(response.status).toBe(404);
  });

  test("URL-encoded scoped packument route returns 404 when the package has no snapshots", async () => {
    const { store } = recordingStore();
    const app = createApp(store);
    const response = await app.request("/@scope%2Fname");
    expect(response.status).toBe(404);
  });

  test("URL-encoded packument route returns 400 on malformed percent-encoding", async () => {
    const { store } = recordingStore();
    const app = createApp(store);
    const response = await app.request("/@scope%2F%E0%A4%A");
    expect(response.status).toBe(400);
  });

  test("URL-encoded packument route returns 400 when it decodes to extra path segments", async () => {
    const { store } = recordingStore();
    const app = createApp(store);
    const response = await app.request("/@scope%2Fname%2Fextra");
    expect(response.status).toBe(400);
  });
});
