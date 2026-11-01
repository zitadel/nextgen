import { describe, expect, it } from "vitest";

import { collectPages } from "../../../../../src/lib/oclif/crud";

type Page = { users: number[]; next_page_token?: string; next_cursor?: string };

/** Answers the pages in order, the first for no cursor; records each cursor it was asked for. */
function source(...pages: Page[]) {
  const asked: (string | undefined)[] = [];
  const walk = async (token: string | undefined): Promise<Page> => {
    asked.push(token);
    const page = pages[asked.length - 1];
    if (page === undefined) {
      throw new Error("asked past the last page");
    }
    return page;
  };
  return { walk, asked };
}

describe("collectPages", () => {
  it("reads one page and reports its next token", async () => {
    const { walk, asked } = source({ users: [1, 2], next_page_token: "p2" }, { users: [3] });
    await expect(
      collectPages(walk, {
        items: (page) => page.users,
        all: false,
        next: (page) => page.next_page_token,
      }),
    ).resolves.toEqual({
      items: [1, 2],
      next: "p2",
    });
    expect(asked).toEqual([undefined]);
  });

  it("reports no next token on the last page", async () => {
    const { walk } = source({ users: [3] });
    await expect(
      collectPages(walk, {
        items: (page) => page.users,
        all: false,
        next: (page) => page.next_page_token,
      }),
    ).resolves.toEqual({
      items: [3],
      next: null,
    });
  });

  it("reads every page in order with all", async () => {
    const { walk, asked } = source(
      { users: [1], next_page_token: "p2" },
      { users: [2], next_page_token: "p3" },
      { users: [3] },
    );
    await expect(
      collectPages(walk, {
        items: (page) => page.users,
        all: true,
        next: (page) => page.next_page_token,
      }),
    ).resolves.toEqual({
      items: [1, 2, 3],
      next: null,
    });
    expect(asked).toEqual([undefined, "p2", "p3"]);
  });

  it("reads the cursor the caller names", async () => {
    const { walk } = source({ users: [1], next_page_token: "ignored", next_cursor: "c2" });
    await expect(
      collectPages(walk, {
        items: (page) => page.users,
        all: false,
        next: (page) => page.next_cursor,
      }),
    ).resolves.toEqual({ items: [1], next: "c2" });
  });

  it("reports an empty cursor on the one page it reads as no next page", async () => {
    const { walk } = source({ users: [1], next_page_token: "" });
    await expect(
      collectPages(walk, {
        items: (page) => page.users,
        all: false,
        next: (page) => page.next_page_token,
      }),
    ).resolves.toEqual({ items: [1], next: null });
  });
});
