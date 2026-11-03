import { describe, expect, it } from "vitest";

import { IsDirty } from "../../../../../src/lib/git/operations/is-dirty";
import { fakeGit } from "../../../../helpers/git-repo";

describe("IsDirty", () => {
  it("is clean when status lists nothing", async () => {
    expect(await new IsDirty().run(fakeGit(() => ({ stdout: "" })))).toBe(false);
  });

  it("is dirty when status lists a change", async () => {
    expect(await new IsDirty().run(fakeGit(() => ({ stdout: " M a.txt\n" })))).toBe(true);
  });
});
