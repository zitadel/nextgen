import { describe, expect, it, vi } from "vitest";

import { Paging } from "./paging";

type Page = { rows: string[]; next_page_token?: string | null };

const byRows = new Paging<Page, string>({
  items: (page) => {
    return page.rows;
  },
  next: (page) => {
    return page.next_page_token;
  },
});

/** Answers each cursor with the page `chain` holds for it; `""` is the first page. */
function fetchPage(chain: Record<string, { rows: string[]; next?: string }>) {
  return vi.fn(async (token: string | undefined, _number: number): Promise<Page> => {
    const page = chain[token ?? ""] ?? { rows: [] };
    return { rows: page.rows, next_page_token: page.next };
  });
}

describe("Paging#next", () => {
  it.each([
    ["a cursor", { rows: [], next_page_token: "t1" }, "t1"],
    ["an empty cursor", { rows: [], next_page_token: "" }, undefined],
    ["a null cursor", { rows: [], next_page_token: null }, undefined],
    ["no cursor", { rows: [] }, undefined],
  ])("reads %s", (_, page, expected) => {
    expect(byRows.next(page)).toBe(expected);
  });
});

describe("Paging.byField", () => {
  it("reads the cursor field it is told to", () => {
    const paging = Paging.byField("users", "next_cursor");

    expect(paging.next({ next_cursor: "c2", next_page_token: "t2" })).toBe("c2");
  });

  it("reads next_page_token by default", () => {
    expect(Paging.byField("users").next({ next_page_token: "t1" })).toBe("t1");
  });

  it("reads the list the field names", () => {
    const page = { users: ["a", "b"], next_page_token: "t1" };

    expect(Paging.byField("users").items(page)).toEqual(["a", "b"]);
  });

  it.each([
    ["a page without the field", { next_page_token: "" }],
    ["a field that is not a list", { users: "a" }],
    ["no page at all", null],
  ])("refuses %s, naming the field", (_, page) => {
    expect(() => Paging.byField("users").items(page)).toThrow(
      new TypeError('Unexpected list response: missing "users" array'),
    );
  });
});

describe("Paging#walk", () => {
  it("follows the cursor until the server gives none", async () => {
    const fetch = fetchPage({ "": { rows: ["a"], next: "t1" }, t1: { rows: ["b"] } });

    const { items } = await byRows.collect(byRows.walk(fetch), { all: true });

    expect(items).toEqual(["a", "b"]);
    expect(fetch.mock.calls).toEqual([
      [undefined, 1],
      ["t1", 2],
    ]);
  });

  it("ends at an empty cursor", async () => {
    const fetch = fetchPage({ "": { rows: ["a"], next: "" } });

    const { items } = await byRows.collect(byRows.walk(fetch), { all: true });

    expect(items).toEqual(["a"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("tells the fetch which page of the walk it is", async () => {
    const fetch = fetchPage({
      "": { rows: ["a"], next: "t1" },
      t1: { rows: ["b"], next: "t2" },
      t2: { rows: ["c"] },
    });

    await byRows.collect(byRows.walk(fetch), { all: true });

    expect(fetch.mock.calls.map(([, number]) => number)).toEqual([1, 2, 3]);
  });

  it("fetches the next page only when the loop reaches it", async () => {
    const fetch = fetchPage({ "": { rows: ["a"], next: "t1" }, t1: { rows: ["b"] } });

    for await (const _ of byRows.walk(fetch)) {
      break;
    }

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("walks a list of thousands of pages", async () => {
    const total = 5000;
    const fetch = vi.fn(async (_token: string | undefined, number: number): Promise<Page> => {
      return { rows: [String(number)], next_page_token: number < total ? `t${number}` : undefined };
    });

    const { items } = await byRows.collect(byRows.walk(fetch), { all: true });

    expect(items).toHaveLength(total);
    expect(fetch).toHaveBeenCalledTimes(total);
  });

  it("follows the cursor a page arrived with, whatever the loop does to it", async () => {
    const fetch = fetchPage({ "": { rows: ["a"], next: "t1" }, t1: { rows: ["b"] } });

    const erasing = new Paging<Page, string>({
      items: (page) => {
        delete page.next_page_token;
        return page.rows;
      },
      next: byRows.next.bind(byRows),
    });

    const { items } = await erasing.collect(erasing.walk(fetch), { all: true });

    expect(items).toEqual(["a", "b"]);
  });
});

describe("Paging#collect", () => {
  const chain = {
    "": { rows: ["a", "b"], next: "t1" },
    t1: { rows: ["c"], next: "t2" },
    t2: { rows: ["d"] },
  };

  it("reads one page and reports its cursor", async () => {
    const fetch = fetchPage(chain);

    const collected = await byRows.collect(byRows.walk(fetch), { all: false });

    expect(collected).toMatchObject({ items: ["a", "b"], next: "t1" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports no cursor on the last page", async () => {
    const collected = await byRows.collect(byRows.walk(fetchPage({ "": { rows: ["z"] } })), {
      all: false,
    });

    expect(collected).toMatchObject({ items: ["z"], next: null });
  });

  it("reads an empty cursor on the one page it reads as no next page", async () => {
    const empty = vi.fn(async (): Promise<Page> => {
      return { rows: ["z"], next_page_token: "" };
    });

    const collected = await byRows.collect(byRows.walk(empty), { all: false });

    expect(collected.next).toBeNull();
  });

  it("reads every page in order with all, leaving no cursor", async () => {
    const collected = await byRows.collect(byRows.walk(fetchPage(chain)), { all: true });

    expect(collected).toMatchObject({ items: ["a", "b", "c", "d"], next: null });
  });

  it("hands back the last page it read", async () => {
    const collected = await byRows.collect(byRows.walk(fetchPage(chain)), { all: true });

    expect(collected.last?.rows).toEqual(["d"]);
  });

  it("hands back the first page when it reads only one", async () => {
    const collected = await byRows.collect(byRows.walk(fetchPage(chain)), { all: false });

    expect(collected.last?.rows).toEqual(["a", "b"]);
  });

  it("collects a walk it did not make", async () => {
    async function* pages(): AsyncGenerator<Page> {
      yield { rows: ["x"], next_page_token: "t1" };
      yield { rows: ["y"] };
    }

    const collected = await byRows.collect(pages(), { all: true });

    expect(collected.items).toEqual(["x", "y"]);
  });

  it("reports the cursor of the last page when a walk it did not make ends on a cursor", async () => {
    async function* pages(): AsyncGenerator<Page> {
      yield { rows: ["x"], next_page_token: "t1" };
    }

    const collected = await byRows.collect(pages(), { all: true });

    expect(collected).toMatchObject({ items: ["x"], next: "t1" });
  });

  it("collects a page too large to pass as call arguments", async () => {
    const rows = Array.from({ length: 200_000 }, (_, index) => String(index));
    const one = vi.fn(async (): Promise<Page> => {
      return { rows };
    });

    const collected = await byRows.collect(byRows.walk(one), { all: true });

    expect(collected.items).toHaveLength(200_000);
  });
});
