import { describe, expect, it } from "vitest";

import { collectPages } from "../../../../../src/lib/oclif/crud";

type Page = { users: number[]; next_page_token?: string; next_cursor?: string };

/** The pages a walk hands out, and how many of them the caller pulled. */
function source(...pages: Page[]) {
  const pulled = { count: 0 };
  async function* walk() {
    for (const page of pages) {
      pulled.count += 1;
      yield page;
    }
  }
  return { walk: walk(), pulled };
}

describe("collectPages", () => {
  it("reads one page and reports its next token", async () => {
    const { walk, pulled } = source({ users: [1, 2], next_page_token: "p2" }, { users: [3] });
    await expect(collectPages(walk, { items: (page) => page.users, all: false })).resolves.toEqual({
      items: [1, 2],
      next: "p2",
    });
    expect(pulled.count).toBe(1);
  });

  it("reports no next token on the last page", async () => {
    const { walk } = source({ users: [3] });
    await expect(collectPages(walk, { items: (page) => page.users, all: false })).resolves.toEqual({
      items: [3],
      next: null,
    });
  });

  it("reads every page in order with all", async () => {
    const { walk } = source(
      { users: [1], next_page_token: "p2" },
      { users: [2], next_page_token: "p3" },
      { users: [3] },
    );
    await expect(collectPages(walk, { items: (page) => page.users, all: true })).resolves.toEqual({
      items: [1, 2, 3],
      next: null,
    });
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
});
