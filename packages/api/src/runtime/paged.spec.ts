import { describe, expect, it, vi } from "vitest";

import { paged } from "./paged";

/** Reads a page's `rows` and its cursor, as a generated table entry does. */
const rows = {
  items: (page: { rows: string[] }) => page.rows,
  next: (page: { next_page_token?: string }) => page.next_page_token,
};

/** Hooks that leave every page and failure as they are. */
const asIs = {
  respond: (body: unknown) => body,
  fail: (error: unknown): never => {
    throw error;
  },
};

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

    await paged(call, { ...rows, arg: 1 }, asIs).all("user_1", { limit: 1 });

    expect(call.mock.calls).toEqual([
      ["user_1", { limit: 1 }],
      ["user_1", { limit: 1, page_token: "t1" }],
    ]);
  });

  it("adds the argument when the caller left it off", async () => {
    const call = endpoint();

    await paged(call, { ...rows, arg: 1 }, asIs).all("user_1");

    expect(call.mock.calls[1]).toEqual(["user_1", { page_token: "t1" }]);
  });

  it("collects every page's items in order", async () => {
    expect(await paged(endpoint(), { ...rows, arg: 1 }, asIs).all("user_1")).toEqual(["a", "b"]);
  });

  it("reads the cursor before its response hook sees the page", async () => {
    const reshape = {
      ...asIs,
      respond: (body: unknown) => ({ rows: (body as { rows: string[] }).rows, renamed: true }),
    };

    expect(await paged(endpoint(), { ...rows, arg: 1 }, reshape).all("user_1")).toEqual(["a", "b"]);
  });

  it("waits for a response hook that answers later", async () => {
    const later = { ...asIs, respond: async (body: unknown) => body };

    expect(await paged(endpoint(), { ...rows, arg: 1 }, later).all("user_1")).toEqual(["a", "b"]);
  });

  it("starts at the page_token among its arguments", async () => {
    const call = vi.fn(async () => ({ rows: ["c"], next_page_token: "" }));

    expect(
      await paged(call, { ...rows, arg: 1 }, asIs).all("user_1", { page_token: "c3" }),
    ).toEqual(["c"]);
    expect(call.mock.calls).toEqual([["user_1", { page_token: "c3" }]]);
  });

  it("hands every failure of the walk to its error hook once", async () => {
    const seen: unknown[] = [];
    const call = vi.fn(async () => {
      throw new Error("down");
    });
    const record = {
      ...asIs,
      fail: (error: unknown): never => {
        seen.push(error);
        throw new Error("handled");
      },
    };

    await expect(paged(call, { ...rows, arg: 0 }, record).all()).rejects.toThrow("handled");
    expect(seen).toHaveLength(1);
  });
});
