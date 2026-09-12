import { describe, expect, it, vi } from "vitest";

import { collectPages } from "../../../../../src/lib/oclif/crud";

describe("collectPages", () => {
  it("fetches one page and reports its next token", async () => {
    const request = vi.fn(async () => ({ users: [1, 2], next_page_token: "p2" }));
    await expect(collectPages(request, { items: "users", all: false })).resolves.toEqual({
      items: [1, 2],
      next: "p2",
    });
    expect(request).toHaveBeenCalledWith(undefined);
  });

  it("starts from the given token", async () => {
    const request = vi.fn(async () => ({ users: [3] }));
    await expect(
      collectPages(request, { items: "users", all: false, token: "p2" }),
    ).resolves.toEqual({
      items: [3],
      next: null,
    });
    expect(request).toHaveBeenCalledWith("p2");
  });

  it("drains every page in order with all", async () => {
    const pages: Record<string, unknown> = {
      first: { users: [1], next_page_token: "p2" },
      p2: { users: [2], next_page_token: "p3" },
      p3: { users: [3] },
    };
    const request = vi.fn(async (token?: string) => pages[token ?? "first"]);
    await expect(collectPages(request, { items: "users", all: true })).resolves.toEqual({
      items: [1, 2, 3],
      next: null,
    });
    expect(request.mock.calls.map(([token]) => token)).toEqual([undefined, "p2", "p3"]);
  });

  it("treats an empty next_page_token as the last page", async () => {
    await expect(
      collectPages(async () => ({ users: [], next_page_token: "" }), { items: "users", all: true }),
    ).resolves.toEqual({ items: [], next: null });
  });

  it("stops when the server repeats a cursor, rather than draining forever", async () => {
    // A server that keeps handing back the same token would otherwise loop.
    const request = vi.fn(async () => ({ users: [1], next_page_token: "same" }));
    await expect(collectPages(request, { items: "users", all: true })).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "The server repeated a page cursor, so --all would never finish",
      details: { page_token: "same" },
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects a response without the items array", async () => {
    await expect(
      collectPages(async () => ({ nope: [] }), { items: "users", all: false }),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: 'Unexpected list response: missing "users" array',
    });
  });
});
