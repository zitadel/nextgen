import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { beforeEach, describe, expect, it } from "vitest";

import { ENV_LOCAL, isSafeForSecrets, mergeEnvFile, storeClientSecret } from "../../../../src/lib/idp";

const exec = promisify(execFile);

let cwd: string;

/** A throwaway git repository, since the ignore check asks git itself. */
async function initRepo(gitignore?: string): Promise<void> {
  await exec("git", ["init", "--quiet"], { cwd });
  if (gitignore !== undefined) {
    await writeFile(join(cwd, ".gitignore"), gitignore, "utf8");
  }
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "zitadel-idp-cred-"));
});

describe("isSafeForSecrets", () => {
  it("is true for a file the repository ignores", async () => {
    await initRepo(".env*\n!.env.example\n");
    expect(await isSafeForSecrets(cwd, ENV_LOCAL)).toBe(true);
  });

  it("is false when nothing ignores it", async () => {
    await initRepo("node_modules\n");
    expect(await isSafeForSecrets(cwd, ENV_LOCAL)).toBe(false);
  });

  it("is false for a tracked file, whatever the patterns say", async () => {
    await initRepo(".env*\n");
    await writeFile(join(cwd, ENV_LOCAL), "EXISTING=1\n", "utf8");
    // Tracking it beats the pattern: a commit would publish the secret.
    await exec("git", ["add", "--force", ENV_LOCAL], { cwd });
    expect(await isSafeForSecrets(cwd, ENV_LOCAL)).toBe(false);
  });

  it("is true outside a repository, where nothing can be committed", async () => {
    // `zitadel setup` scaffolds .gitignore but does not run `git init`, so a
    // fresh project sits here and must not be refused.
    expect(await isSafeForSecrets(cwd, ENV_LOCAL)).toBe(true);
  });
});

describe("mergeEnvFile", () => {
  it("creates the file when it is missing", async () => {
    expect(await mergeEnvFile(cwd, ".env.local", [{ name: "A", value: "1" }])).toEqual(["A"]);
    expect(await readFile(join(cwd, ".env.local"), "utf8")).toBe("A=1\n");
  });

  it("keeps an existing value instead of replacing it", async () => {
    await writeFile(join(cwd, ".env.local"), "A=mine\n", "utf8");
    expect(await mergeEnvFile(cwd, ".env.local", [{ name: "A", value: "theirs" }])).toEqual([]);
    expect(await readFile(join(cwd, ".env.local"), "utf8")).toBe("A=mine\n");
  });

  it("appends without disturbing what is there, adding a newline if needed", async () => {
    await writeFile(join(cwd, ".env.local"), "# comment\nA=1", "utf8");
    expect(await mergeEnvFile(cwd, ".env.local", [{ name: "B", value: "2" }])).toEqual(["B"]);
    expect(await readFile(join(cwd, ".env.local"), "utf8")).toBe("# comment\nA=1\nB=2\n");
  });

  it("writes a name with no value for an example file", async () => {
    await mergeEnvFile(cwd, ".env.example", [{ name: "GOOGLE_CLIENT_SECRET" }]);
    expect(await readFile(join(cwd, ".env.example"), "utf8")).toBe("GOOGLE_CLIENT_SECRET=\n");
  });
});

describe("storeClientSecret", () => {
  const name = "GOOGLE_CLIENT_SECRET";

  it("writes the value only when the file is ignored", async () => {
    await initRepo(".env*\n!.env.example\n");
    expect(await storeClientSecret({ cwd, name, value: "s3cret" })).toEqual({ stored: true, name });
    expect(await readFile(join(cwd, ENV_LOCAL), "utf8")).toContain("GOOGLE_CLIENT_SECRET=s3cret");
    expect(await readFile(join(cwd, ".env.example"), "utf8")).toBe("GOOGLE_CLIENT_SECRET=\n");
  });

  it("writes no value when the file is not ignored, and says why", async () => {
    await initRepo("node_modules\n");
    expect(await storeClientSecret({ cwd, name, value: "s3cret" })).toEqual({
      stored: false,
      name,
      reason: "not-ignored",
    });
    await expect(readFile(join(cwd, ENV_LOCAL), "utf8")).rejects.toThrow();
    // The name is still discoverable, just without its value.
    expect(await readFile(join(cwd, ".env.example"), "utf8")).toBe("GOOGLE_CLIENT_SECRET=\n");
  });

  it("stores nothing when no value is supplied", async () => {
    await initRepo(".env*\n!.env.example\n");
    expect(await storeClientSecret({ cwd, name })).toEqual({ stored: false, name, reason: "deferred" });
    await expect(readFile(join(cwd, ENV_LOCAL), "utf8")).rejects.toThrow();
  });

  it("never replaces a secret the developer already set", async () => {
    await initRepo(".env*\n!.env.example\n");
    await writeFile(join(cwd, ENV_LOCAL), "GOOGLE_CLIENT_SECRET=original\n", "utf8");
    await storeClientSecret({ cwd, name, value: "replacement" });
    expect(await readFile(join(cwd, ENV_LOCAL), "utf8")).toBe("GOOGLE_CLIENT_SECRET=original\n");
  });
});
