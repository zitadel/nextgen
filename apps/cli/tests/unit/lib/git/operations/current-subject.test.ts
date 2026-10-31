import { describe, expect, it } from "vitest";

import { CurrentSubject } from "../../../../../src/lib/git/operations/current-subject";
import { fakeGit } from "../../../../helpers/git-repo";

describe("CurrentSubject", () => {
  it("gives HEAD's subject", async () => {
    expect(await new CurrentSubject().run(fakeGit(() => ({ stdout: "add company\n" })))).toBe(
      "add company",
    );
  });

  it("gives null before the first commit", async () => {
    expect(await new CurrentSubject().run(fakeGit(() => ({ exitCode: 128 })))).toBeNull();
  });

  it("gives null for a commit with an empty subject", async () => {
    expect(await new CurrentSubject().run(fakeGit(() => ({ stdout: "\n" })))).toBeNull();
  });

  it("overrides a developer's log.showSignature", async () => {
    const asked: (readonly string[])[] = [];

    await new CurrentSubject().run(
      fakeGit((args) => {
        asked.push(args);
        return { stdout: "add company\n" };
      }),
    );

    expect(asked[0]).toContain("--no-show-signature");
  });
});
