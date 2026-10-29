import { describe, expect, it } from "vitest";

import { Change } from "../../../../src/lib/git/change";
import { GitResult } from "../../../../src/lib/git/git";

const isEnv = (path: string): boolean => path.endsWith(".env");

describe("Change.listedIn", () => {
  it("reads each status and path", () => {
    const listed = new GitResult(0, "M\0a\0A\0b\0D\0c\0T\0d\0", "");

    expect(Change.listedIn(listed).map(({ path, status }) => ({ path, status }))).toEqual([
      { path: "a", status: "modified" },
      { path: "b", status: "added" },
      { path: "c", status: "deleted" },
      { path: "d", status: "modified" },
    ]);
  });

  it("reads a rename's source and destination", () => {
    const [change] = Change.listedIn(new GitResult(0, "R100\0old\0new\0", ""));

    expect(change).toMatchObject({ path: "new", status: "renamed", previousPath: "old" });
  });
});

describe("Change.without", () => {
  it("keeps a change to a file not excluded", () => {
    const change = new Change("a", "modified");

    expect(change.without(isEnv)).toBe(change);
  });

  it("drops a change to an excluded file", () => {
    expect(new Change(".env", "modified").without(isEnv)).toBeNull();
  });

  it("keeps only the deletion of a file renamed to an excluded name", () => {
    expect(new Change(".env", "renamed", "a").without(isEnv)).toEqual(new Change("a", "deleted"));
  });

  it("keeps only the addition of a file renamed from an excluded name", () => {
    expect(new Change("a", "renamed", ".env").without(isEnv)).toEqual(new Change("a", "added"));
  });

  it("drops a rename between two excluded names", () => {
    expect(new Change("b.env", "renamed", "a.env").without(isEnv)).toBeNull();
  });
});

describe("Change.paths", () => {
  it("covers both ends of a rename", () => {
    expect(new Change("new", "renamed", "old").paths()).toEqual(["old", "new"]);
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
});

describe("Change, beyond renames", () => {
  it("reads a copy's source and destination", () => {
    const [change] = Change.listedIn(new GitResult(0, "C075\0old\0new\0", ""));

    expect(change).toMatchObject({ path: "new", status: "copied", previousPath: "old" });
  });

  it("keeps a rename whole when neither end is excluded", () => {
    const change = new Change("b", "renamed", "a");

    expect(change.without(isEnv)).toBe(change);
  });

  it("covers only its own path for a plain change", () => {
    expect(new Change("a", "modified").paths()).toEqual(["a"]);
  });

  it("reports a plain change with no previous path", () => {
    expect(new Change("a", "modified").diffedWith("p")).toEqual({
      path: "a",
      status: "modified",
      patch: "p",
    });
  });
});
