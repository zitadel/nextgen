import { describe, expect, it } from "vitest";

import { CONFIG_DIRECTORIES, MemoryStore } from "@/lib/zitadel";

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
