import { describe, expect, it } from "vitest";

import { ZitadelClient } from "./client";
import { paged } from "./paged";

/** The client every page is fetched with. */
const client = new ZitadelClient({ baseUrl: "http://127.0.0.1:1" });

/** Reads a page's `rows` and its cursor, as a generated table entry does. */
const rows = {
  items: (page: { rows: string[] }) => page.rows,
  next: (page: { next_page_token?: string }) => page.next_page_token,
  withToken: ([first, id, params]: unknown[], page_token: string) => [
    first,
    id,
    Object.assign({}, params, { page_token }),
  ],
};

/** Hooks that leave every page and failure as they are. */
const asIs = {
  respond: (body: unknown) => body,
  fail: (error: unknown): never => {
    throw error;
  },
};

/**
 * `answer` as the `send` a paged function is given, keeping the arguments of
 * every call it answered.
 */
function recording(answer: (...args: unknown[]) => Promise<unknown>) {
  const calls: unknown[][] = [];
  const send = (...args: unknown[]) => {
    calls.push(args);
    return answer(...args);
  };
  return Object.assign(send, { calls });
}

describe("paged", () => {
  /** A generated function taking `(client, id, params)`, answering two pages. */
  function endpoint() {
    return recording(async (...args: unknown[]) => {
      const params = args[2] as { page_token?: string; limit?: number } | undefined;
      return params?.page_token === undefined
        ? { rows: ["a"], next_page_token: "t1" }
        : { rows: ["b"] };
    });
  }

  it("fetches every page with its client first, and the next one with the arguments its shape builds from the cursor", async () => {
    const call = endpoint();

    await paged(client, call, rows, asIs).all("user_1", { limit: 1 });

    expect(call.calls).toEqual([
      [client, "user_1", { limit: 1 }],
      [client, "user_1", { limit: 1, page_token: "t1" }],
    ]);
  });

  it("follows the cursor its shape reads, whatever the field is called", async () => {
    const call = recording(async (...args: unknown[]) =>
      (args[1] as { page_token?: string } | undefined)?.page_token === undefined
        ? { rows: ["a"], cursor: "t1" }
        : { rows: ["b"] },
    );
    const shape = {
      items: (page: { rows: string[] }) => page.rows,
      next: (page: { cursor?: string }) => page.cursor,
      withToken: ([first, params]: unknown[], page_token: string) => [
        first,
        Object.assign({}, params, { page_token }),
      ],
    };

    expect(await paged(client, call, shape, asIs).all()).toEqual(["a", "b"]);
  });

  it("collects every page's items in order", async () => {
    expect(await paged(client, endpoint(), rows, asIs).all("user_1")).toEqual(["a", "b"]);
  });

  it("collects a page too large to pass as call arguments", async () => {
    const large = Array.from({ length: 200_000 }, (_, index) => String(index));
    const call = recording(async () => {
      return { rows: large };
    });

    const collected = await paged(client, call, rows, asIs).all();

    expect(collected).toHaveLength(200_000);
  });

  it("reads the cursor before its response hook sees the page", async () => {
    const reshape = {
      ...asIs,
      respond: (body: unknown) => ({ rows: (body as { rows: string[] }).rows, renamed: true }),
    };

    expect(await paged(client, endpoint(), rows, reshape).all("user_1")).toEqual(["a", "b"]);
  });

  it("waits for a response hook that answers later", async () => {
    const later = { ...asIs, respond: async (body: unknown) => body };

    expect(await paged(client, endpoint(), rows, later).all("user_1")).toEqual(["a", "b"]);
  });

  it("starts at the page_token among its arguments", async () => {
    const call = recording(async () => ({ rows: ["c"], next_page_token: "" }));

    expect(await paged(client, call, rows, asIs).all("user_1", { page_token: "c3" })).toEqual([
      "c",
    ]);
    expect(call.calls).toEqual([[client, "user_1", { page_token: "c3" }]]);
  });

  it("hands every failure of the walk to its error hook once", async () => {
    const seen: unknown[] = [];
    const call = recording(async () => {
      throw new Error("down");
    });
    const record = {
      ...asIs,
      fail: (error: unknown): never => {
        seen.push(error);
        throw new Error("handled");
      },
    };

    await expect(paged(client, call, rows, record).all()).rejects.toThrow("handled");
    expect(seen).toHaveLength(1);
  });
});
