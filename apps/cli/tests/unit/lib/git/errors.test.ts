import { describe, expect, it } from "vitest";

import {
  GitBinaryMissingError,
  GitCommandFailedError,
  GitError,
  GitInternalError,
} from "@/lib/git/errors";

describe("a git error's cause", () => {
  it("is kept", () => {
    const cause = new Error("underneath");

    expect(new GitCommandFailedError("why", cause).cause).toBe(cause);
  });
});

describe("GitBinaryMissingError", () => {
  it("is a GitError", () => {
    expect(new GitBinaryMissingError("why")).toBeInstanceOf(GitError);
  });

  it("is a precondition under its own name", () => {
    expect(new GitBinaryMissingError("why")).toMatchObject({
      name: "GitBinaryMissingError",
      category: "conflict",
      retryable: false,
      code: "E_VALIDATION",
    });
  });
});

describe("GitCommandFailedError", () => {
  it("is a GitError", () => {
    expect(new GitCommandFailedError("why")).toBeInstanceOf(GitError);
  });

  it("is unexpected, because nothing knows why git failed", () => {
    expect(new GitCommandFailedError("why")).toMatchObject({
      name: "GitCommandFailedError",
      category: "unknown",
      retryable: false,
      code: "E_VALIDATION",
    });
  });
});

describe("GitInternalError", () => {
  it("is a GitError", () => {
    expect(new GitInternalError("why")).toBeInstanceOf(GitError);
  });

  it("is internal under its own name", () => {
    expect(new GitInternalError("why")).toMatchObject({
      name: "GitInternalError",
      category: "fault",
      retryable: false,
      code: "E_VALIDATION",
    });
  });
});

describe("GitError.headline", () => {
  it("takes the line that says why git failed, past the warnings before it", () => {
    expect(
      new GitCommandFailedError(
        "warning: in the working copy of 'a.txt', LF will be replaced by CRLF\nerror: open(\"c.txt\"): Permission denied\nfatal: adding files failed",
      ).headline(),
    ).toBe('error: open("c.txt"): Permission denied');
  });

  it("takes a fatal line", () => {
    expect(
      new GitCommandFailedError("hint: try this\nfatal: refused\nhint: or that").headline(),
    ).toBe("fatal: refused");
  });

  it("takes the first line when git names no fatal or error line", () => {
    expect(new GitCommandFailedError("git did not finish in time").headline()).toBe(
      "git did not finish in time",
    );
  });

  it("says git gave no reason rather than nothing", () => {
    expect(new GitCommandFailedError("").headline()).toBe("git gave no reason");
  });
});
