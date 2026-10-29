import { describe, expect, it } from "vitest";

import { AuthorIdentity } from "../../../../src/lib/git/author-identity";
import { fakeGit } from "../../../helpers/git-repo";

const FALLBACK = { name: "Fallback", email: "fallback@example.com" };

/** A git that has its own identity when `own`, and can guess one when `guess`. */
function gitWith(own: boolean, guess: boolean) {
  return fakeGit((args) => {
    const configured = args.includes("user.useConfigOnly=true");
    if ((configured && own) || (!configured && guess)) {
      return {};
    }
    return { exitCode: 128 };
  });
}

describe("AuthorIdentity", () => {
  it.each([
    [true, true, "yours"],
    [false, true, "guessed"],
    [false, false, "fallback"],
  ])("with its own %s and a guess %s, comes from %s", async (own, guess, source) => {
    expect((await AuthorIdentity.of(gitWith(own, guess), FALLBACK)).source).toBe(source);
  });

  it("names the fallback as author and committer when git has no identity", async () => {
    expect((await AuthorIdentity.of(gitWith(false, false), FALLBACK)).environment()).toEqual({
      GIT_AUTHOR_NAME: "Fallback",
      GIT_AUTHOR_EMAIL: "fallback@example.com",
      GIT_COMMITTER_NAME: "Fallback",
      GIT_COMMITTER_EMAIL: "fallback@example.com",
    });
  });

  it.each([
    [true, true],
    [false, true],
  ])("adds nothing when git has an identity (own %s)", async (own, guess) => {
    expect((await AuthorIdentity.of(gitWith(own, guess), FALLBACK)).environment()).toEqual({});
  });
});
