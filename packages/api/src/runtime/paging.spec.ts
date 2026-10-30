import { describe, expect, it, vi } from "vitest";

import { nextToken, paged, pages } from "./paging";

/** Answers each cursor with the page `chain` holds for it; `""` is the first page. */
function fetchPage(chain: Record<string, { rows: string[]; next?: string }>) {
  return vi.fn(async (token: string | undefined) => {
    const page = chain[token ?? ""] ?? { rows: [] };
    return { rows: page.rows, next_page_token: page.next };
  });
}

describe("nextToken", () => {
  it.each([
    ["a cursor", { next_page_token: "t1" }, "t1"],
    ["an empty cursor", { next_page_token: "" }, undefined],
    ["a null cursor", { next_page_token: null }, undefined],
    ["no cursor", {}, undefined],
  ])("reads %s", (_, page, expected) => {
    expect(nextToken(page)).toBe(expected);
  });

  it("reads the field it is told to", () => {
    expect(nextToken({ next_cursor: "c2", next_page_token: "t2" }, "next_cursor")).toBe("c2");
  });
});

describe("pages", () => {
  it("follows the cursor until the server gives none", async () => {
    const fetch = fetchPage({ "": { rows: ["a"], next: "t1" }, t1: { rows: ["b"] } });

    const rows = [];
    for await (const page of pages(fetch)) rows.push(...page.rows);

    expect(rows).toEqual(["a", "b"]);
    expect(fetch.mock.calls).toEqual([[undefined], ["t1"]]);
  });

  it("fetches the next page only when the loop reaches it", async () => {
    const fetch = fetchPage({ "": { rows: ["a"], next: "t1" }, t1: { rows: ["b"] } });

    for await (const _ of pages(fetch)) break;

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses a cursor the server already issued", async () => {
    const fetch = fetchPage({ "": { rows: ["a"], next: "t1" }, t1: { rows: ["b"], next: "t1" } });

    await expect(async () => {
      for await (const _ of pages(fetch));
    }).rejects.toThrow("The server repeated a page cursor, so the list would never end");
  });

  it("refuses the cursor it started from without fetching that page again", async () => {
    const fetch = fetchPage({ "": { rows: ["b"], next: "t1" } });

    await expect(async () => {
      for await (const _ of pages(fetch, { start: "t1" }));
    }).rejects.toThrow("The server repeated a page cursor");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("follows the cursor the reader it is given names", async () => {
    const fetch = vi.fn(async (token: string | undefined) =>
      token === undefined ? { next_cursor: "c2" } : {},
    );

    for await (const _ of pages(fetch, { next: (page) => nextToken(page, "next_cursor") }));

    expect(fetch.mock.calls).toEqual([[undefined], ["c2"]]);
  });
});

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
      'Expected the response to carry a "rows" array',
    );
  });
});
