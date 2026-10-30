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
    }).rejects.toMatchObject({
      name: "RepeatedCursorError",
      cursor: "t1",
      message:
        "The server returned the same page cursor twice, so the list would never end. " +
        "Read it one page at a time instead.",
    });
  });

  it("begins at the cursor it is given", async () => {
    const fetch = fetchPage({ t1: { rows: ["b"], next: "t2" }, t2: { rows: ["c"] } });

    const rows = [];
    for await (const page of pages(fetch, { start: "t1" })) rows.push(...page.rows);

    expect(rows).toEqual(["b", "c"]);
    expect(fetch.mock.calls).toEqual([["t1"], ["t2"]]);
  });

  it("refuses the cursor it started from without fetching that page again", async () => {
    const fetch = fetchPage({ t1: { rows: ["b"], next: "t1" } });

    await expect(async () => {
      for await (const _ of pages(fetch, { start: "t1" }));
    }).rejects.toThrow("The server returned the same page cursor twice");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("follows the cursor the reader it is given names", async () => {
    const fetch = vi.fn(async (token: string | undefined) =>
      token === undefined ? { next_cursor: "c2" } : {},
    );

    for await (const _ of pages(fetch, { next: (page) => nextToken(page, "next_cursor") }));

    expect(fetch.mock.calls).toEqual([[undefined], ["c2"]]);
  });

  it("ends at an empty cursor the reader it is given returns", async () => {
    const fetch = vi.fn(async (token: string | undefined) =>
      token === undefined ? { next_cursor: "c2" } : { next_cursor: "" },
    );

    for await (const _ of pages(fetch, { next: (page) => page.next_cursor }));

    expect(fetch.mock.calls).toEqual([[undefined], ["c2"]]);
  });

  it("follows the cursor a page arrived with, whatever the loop does to it", async () => {
    const fetch = fetchPage({ "": { rows: ["a"], next: "t1" }, t1: { rows: ["b"] } });

    const rows = [];
    for await (const page of pages(fetch)) {
      rows.push(...page.rows);
      delete (page as { next_page_token?: string }).next_page_token;
    }

    expect(rows).toEqual(["a", "b"]);
  });
});
