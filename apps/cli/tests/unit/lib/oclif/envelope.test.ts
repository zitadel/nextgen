import { describe, expect, it } from "vitest";

import { listData } from "@/lib/oclif/envelope";

describe("listData", () => {
  it("counts the items and says nothing remains when no cursor is given", () => {
    expect(listData(["a", "b"])).toEqual({
      items: ["a", "b"],
      count: 2,
      truncated: false,
      next_page_token: null,
    });
  });

  it("says more remain, with the cursor, when a page is cut short", () => {
    expect(listData(["a"], { nextPageToken: "p2" })).toMatchObject({
      truncated: true,
      next_page_token: "p2",
    });
  });

  it("says nothing remains once the cursor is drained", () => {
    expect(listData(["a"], { nextPageToken: null })).toMatchObject({
      truncated: false,
      next_page_token: null,
    });
  });

  it("names the cursor as the caller asks", () => {
    expect(
      listData([], {
        nextPageToken: "n",
        cursorKey: "next_cursor",
      }),
    ).toMatchObject({
      truncated: true,
      next_cursor: "n",
    });
  });
});
