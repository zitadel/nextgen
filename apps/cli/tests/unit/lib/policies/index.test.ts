import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Git } from "@/lib/git/git";
import { readJsonDirEntries } from "@/lib/json-dir";
import {
  isPolicyTestFile,
  PASSWORD_POLICY_PATH,
  POLICIES_DIR,
  POLICY_FILES_GLOB,
  POLICY_TEST_FILES_GLOB,
  parsePasswordMinLength,
  passwordPolicyFile,
} from "@/lib/policies";
import { GitScratch, isolateGit } from "@tests/helpers/git-repo";

describe("parsePasswordMinLength", () => {
  it.each([
    // "None" is an answer of its own, apart from not being asked at all.
    ["", null],
    ["  ", null],
    // A minimum of 0 enforces nothing: it means none, never a stored 0.
    ["0", null],
    ["00", null],
    ["1", 1],
    ["15", 15],
    ["64", 64],
  ])("reads %j as %j", (text, value) => {
    expect(parsePasswordMinLength(text)).toEqual({ ok: true, value });
  });

  it.each(["65", "12.5", "-3", "twelve", "1e1"])("refuses %j", (text) => {
    expect(parsePasswordMinLength(text)).toMatchObject({
      ok: false,
      problem: "Must be a whole number from 1 to 64, or 0 for none",
    });
  });
});

describe("passwordPolicyFile", () => {
  it("sets the recommended minimum when none was given", () => {
    expect(passwordPolicyFile()).toEqual({
      $schema: "../meta/policy.json",
      operation: "auth.factor.password.set",
      config: { min_length: 15 },
    });
  });

  it("enforces nothing for an explicit none", () => {
    expect(passwordPolicyFile(null).config).toEqual({});
  });

  it("sets the minimum it is given", () => {
    expect(passwordPolicyFile(12).config).toEqual({ min_length: 12 });
  });

  it("is written where the policy syncer expects it", () => {
    expect(PASSWORD_POLICY_PATH).toBe(".zitadel/policies/auth.factor.password.set.json");
  });
});

const scratch = new GitScratch();

beforeEach(isolateGit);

afterEach(async () => {
  await scratch.cleanup();
});

describe("POLICY_FILES_GLOB and POLICY_TEST_FILES_GLOB", () => {
  it("take in for git exactly the policy files the bundle reads", async () => {
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
      Object.fromEntries(names.map((name) => [`${POLICIES_DIR}/${name}`, "{}\n"])),
    );

    const diffed = await new Git(cwd).run([
      "ls-files",
      "-z",
      "--",
      Git.glob(POLICY_FILES_GLOB),
      Git.excluded(POLICY_TEST_FILES_GLOB),
    ]);
    const read = await readJsonDirEntries(join(cwd, POLICIES_DIR), { skip: isPolicyTestFile });

    expect(diffed.paths()).toEqual(read.map((entry) => `${POLICIES_DIR}/${entry.name}`));
    expect(diffed.paths()).toEqual([`${POLICIES_DIR}/a.json`, `${POLICIES_DIR}/b.TEST.json`]);
  });
});
