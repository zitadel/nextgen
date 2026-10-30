import { describe, expect, it } from "vitest";

import { GitDidNotStartError, RepositoryError } from "../../../../src/lib/git/errors";

describe("RepositoryError", () => {
  it("carries its message and name", () => {
    expect(new RepositoryError("why")).toMatchObject({ message: "why", name: "RepositoryError" });
  });
});

describe("GitDidNotStartError", () => {
  it("is a RepositoryError", () => {
    expect(new GitDidNotStartError("why")).toBeInstanceOf(RepositoryError);
  });

  it("carries its own name", () => {
    expect(new GitDidNotStartError("why").name).toBe("GitDidNotStartError");
  });
});

describe("RepositoryError.headline", () => {
  it("takes the line that says why git failed, past the warnings before it", () => {
    expect(
      new RepositoryError(
        "warning: in the working copy of 'a.txt', LF will be replaced by CRLF\nerror: open(\"c.txt\"): Permission denied\nfatal: adding files failed",
      ).headline(),
    ).toBe('error: open("c.txt"): Permission denied');
  });

  it("takes a fatal line", () => {
    expect(new RepositoryError("hint: try this\nfatal: refused\nhint: or that").headline()).toBe(
      "fatal: refused",
    );
  });

  it("takes the first line when git names no fatal or error line", () => {
    expect(new RepositoryError("git did not finish in time").headline()).toBe(
      "git did not finish in time",
    );
  });

  it("says git gave no reason rather than nothing", () => {
    expect(new RepositoryError("").headline()).toBe("git gave no reason");
  });
});
