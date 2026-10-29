import { describe, expect, it } from "vitest";

import { Change } from "../../../../src/lib/git/change";

describe("Change.listedIn", () => {
  it("reads each status and path", () => {
    const listed = [
      ":100644 100644 1 2 M",
      "a",
      ":000000 100644 0 2 A",
      "b",
      ":100644 000000 1 0 D",
      "c",
      ":100644 120000 1 2 T",
      "d",
    ];

    expect(Change.listedIn(listed).map(({ path, status }) => ({ path, status }))).toEqual([
      { path: "a", status: "modified" },
      { path: "b", status: "added" },
      { path: "c", status: "deleted" },
      { path: "d", status: "modified" },
    ]);
  });

  it.each([
    ["R100", "renamed"],
    ["C075", "copied"],
  ])("reads where a %s entry came from and went", (letter, status) => {
    const [change] = Change.listedIn([`:100644 100644 1 1 ${letter}`, "old", "new"]);

    expect(change).toMatchObject({ path: "new", status, previousPath: "old" });
  });

  it("reads a path that starts like an entry", () => {
    expect(Change.listedIn([":100644 100644 1 2 M", ":odd name"])).toEqual([
      new Change(":odd name", "modified"),
    ]);
  });

  it("lists nothing for an empty list", () => {
    expect(Change.listedIn([])).toEqual([]);
  });
});

describe("Change.diffedWith", () => {
  it("reports a rename with where it came from", () => {
    expect(new Change("new", "renamed", "old").diffedWith("p")).toEqual({
      path: "new",
      status: "renamed",
      previous_path: "old",
      patch: "p",
    });
  });

  it("reports a plain change with no previous path", () => {
    expect(new Change("a", "modified").diffedWith("p")).toEqual({
      path: "a",
      status: "modified",
      patch: "p",
    });
  });
});
