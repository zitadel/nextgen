import { describe, expect, it, vi } from "vitest";

import { nextToken, pages } from "./paging";

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
