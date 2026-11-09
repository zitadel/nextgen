import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Git } from "@/lib/git/git";
import { CONFIG_DIRECTORIES, DiskStore, RELEASE_POLICY_GLOBS, ZitadelConfig } from "@/lib/zitadel";
import { GitScratch, isolateGit } from "@tests/helpers/git-repo";

/**
 * Throwaway repositories, removed after each test.
 */
const scratch = new GitScratch();

beforeEach(isolateGit);

afterEach(async () => {
  await scratch.cleanup();
});

describe("RELEASE_POLICY_GLOBS", () => {
  it("takes in for git exactly the policy files the bundle reads", async () => {
    const names = [
      "a.json",
      "a.test.json",
      ".test.json",
      "b.TEST.json",
      "c.json.bak",
      "README.md",
      "sub/d.json",
      "sub/d.test.json",
    ];
    const cwd = await scratch.committed(
      Object.fromEntries(
        names.map((name) => {
          return [`${CONFIG_DIRECTORIES.policies}/${name}`, "{}\n"];
        }),
      ),
    );
    const config = await ZitadelConfig.loadUnchecked(new DiskStore(cwd));

    const diffed = await new Git(cwd).run([
      "ls-files",
      "-z",
      "--",
      Git.glob(RELEASE_POLICY_GLOBS.included),
      Git.excluded(RELEASE_POLICY_GLOBS.excluded),
    ]);

    expect(diffed.paths()).toEqual(
      config.policies.all.map((policy) => {
        return policy.path;
      }),
    );
  });

  it("leaves out the test files, the README and the subdirectories", async () => {
    const cwd = await scratch.committed(
      Object.fromEntries(
        ["a.json", "a.test.json", "README.md", "sub/d.json"].map((name) => {
          return [`${CONFIG_DIRECTORIES.policies}/${name}`, "{}\n"];
        }),
      ),
    );

    const diffed = await new Git(cwd).run([
      "ls-files",
      "-z",
      "--",
      Git.glob(RELEASE_POLICY_GLOBS.included),
      Git.excluded(RELEASE_POLICY_GLOBS.excluded),
    ]);

    expect(diffed.paths()).toEqual([`${CONFIG_DIRECTORIES.policies}/a.json`]);
  });
});
