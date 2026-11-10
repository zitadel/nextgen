import { describe, expect, it } from "vitest";

import { CONFIG_DIRECTORIES, MemoryStore, UnparsedFile } from "@/lib/zitadel";

/**
 * A connection's file.
 */
const IDP = `${CONFIG_DIRECTORIES.connections}/a.json`;

describe("MemoryStore.get", () => {
  it("is the body a write left", async () => {
    const store = new MemoryStore();
    await store.write({ path: IDP, body: { slug: "a" } }, "create");

    const body = store.get(IDP);

    expect(body).toEqual({ slug: "a" });
  });

  it("is undefined for a path it does not hold", () => {
    const store = new MemoryStore();

    const body = store.get(IDP);

    expect(body).toBeUndefined();
  });
});

describe("MemoryStore.read", () => {
  it("hands a file it holds unparsed on as it is, without a body", async () => {
    const unparsed = UnparsedFile.invalidJson(IDP, "{ not json");
    const store = new MemoryStore([unparsed]);

    const files = await store.read("connections");

    expect(files).toEqual([unparsed]);
  });

  it("holds no body for a file it holds unparsed", () => {
    const store = new MemoryStore([UnparsedFile.notAnObject(IDP)]);

    const body = store.get(IDP);

    expect(body).toBeUndefined();
  });
});
