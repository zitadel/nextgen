import { describe, expect, it, vi } from "vitest";

import { paged } from "./paged";

describe("paged", () => {
  /** A generated function taking `(id, params)`, answering two pages. */
  function endpoint() {
    return vi.fn(async (...args: unknown[]) => {
      const params = args[1] as { page_token?: string; limit?: number } | undefined;
      return params?.page_token === undefined
        ? { rows: ["a"], next_page_token: "t1" }
        : { rows: ["b"] };
    });
  }

  it("puts the cursor in the argument the shape names", async () => {
    const call = endpoint();

    await paged(call, { items: "rows", arg: 1 }).all("user_1", { limit: 1 });

    expect(call.mock.calls).toEqual([
      ["user_1", { limit: 1 }],
      ["user_1", { limit: 1, page_token: "t1" }],
    ]);
  });

  it("adds the argument when the caller left it off", async () => {
    const call = endpoint();

    await paged(call, { items: "rows", arg: 1 }).all("user_1");

    expect(call.mock.calls[1]).toEqual(["user_1", { page_token: "t1" }]);
  });

  it("collects every page's items in order", async () => {
    expect(await paged(endpoint(), { items: "rows", arg: 1 }).all("user_1")).toEqual(["a", "b"]);
  });

  it("refuses a page without its items array", async () => {
    const call = vi.fn(async () => ({ next_page_token: "" }));

    await expect(paged(call, { items: "rows", arg: 0 }).all()).rejects.toThrow(
      'Unexpected list response: missing "rows" array',
    );
  });
});
