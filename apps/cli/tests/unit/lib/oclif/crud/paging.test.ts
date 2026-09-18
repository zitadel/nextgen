import { describe, expect, it, vi } from "vitest";

import { collectPages, DEFAULT_WIRE } from "../../../../../src/lib/oclif/crud";

const cursor = { nextPageToken: DEFAULT_WIRE.nextPageToken };

describe("collectPages", () => {
  it("fetches one page and reports its next token", async () => {
    const request = vi.fn(async () => ({ users: [1, 2], next_page_token: "p2" }));
    await expect(collectPages(request, { items: "users", all: false, ...cursor })).resolves.toEqual({
      items: [1, 2],
      next: "p2",
    });
    expect(request).toHaveBeenCalledWith(undefined);
  });

  it("starts from the given token", async () => {
    const request = vi.fn(async () => ({ users: [3] }));
    await expect(
      collectPages(request, { items: "users", all: false, token: "p2", ...cursor }),
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
    await expect(collectPages(request, { items: "users", all: true, ...cursor })).resolves.toEqual({
      items: [1, 2, 3],
      next: null,
    });
    expect(request.mock.calls.map(([token]) => token)).toEqual([undefined, "p2", "p3"]);
  });

  it("treats an empty next_page_token as the last page", async () => {
    await expect(
      collectPages(async () => ({ users: [], next_page_token: "" }), { items: "users", all: true, ...cursor }),
    ).resolves.toEqual({ items: [], next: null });
  });

  it("stops when the server repeats a cursor, rather than draining forever", async () => {
    // A server that keeps handing back the same token would otherwise loop.
    const request = vi.fn(async () => ({ users: [1], next_page_token: "same" }));
    await expect(collectPages(request, { items: "users", all: true, ...cursor })).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "The server repeated a page cursor, so --all would never finish",
      details: { cursor: "same" },
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects a response without the items array", async () => {
    await expect(
      collectPages(async () => ({ nope: [] }), { items: "users", all: false, ...cursor }),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: 'Unexpected list response: missing "users" array',
    });
  });
});

describe("a platform that spells its cursor differently", () => {
  it("reads the property the caller named, not this API's", async () => {
    // The factory carries no API's vocabulary: a platform whose cursor is
    // `next_cursor` says so, and the drain follows it.
    const pages: Record<string, unknown> = {
      first: { rows: [1], next_cursor: "c2" },
      c2: { rows: [2] },
    };
    const request = vi.fn(async (token?: string) => pages[token ?? "first"]);

    await expect(
      collectPages(request, { items: "rows", all: true, nextPageToken: "next_cursor" }),
    ).resolves.toEqual({ items: [1, 2], next: null });
    expect(request.mock.calls.map(([token]) => token)).toEqual([undefined, "c2"]);
  });

  it("ignores a cursor under this API's name when told to read another", async () => {
    const request = vi.fn(async () => ({ rows: [1], next_page_token: "ignored" }));
    await expect(
      collectPages(request, { items: "rows", all: false, nextPageToken: "next_cursor" }),
    ).resolves.toEqual({ items: [1], next: null });
  });
});
