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
