import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { warnings } from "@/lib/ui";
import { Project } from "@/lib/project";
import { SecretFile } from "@/lib/project/secret-file";
import { scratchDir } from "@tests/fixtures/scratch";

describe("Project.lockDown", () => {
  it("warns instead of throwing when the mode cannot be applied", async () => {
    warnings.take();
    const missing = join(await scratchDir("zitadel-secret-file-"), "gone");

    await expect(Project.lockDown(missing, 0o600)).resolves.toBeUndefined();

    expect(warnings.take()).toEqual([expect.stringContaining("could not set it to 0600 (ENOENT)")]);
  });
});

describe("SecretFile modes", () => {
  it.each([
    ["linux", true],
    ["darwin", true],
    ["win32", false],
  ] as const)("keeps modes on %s: %s", (platform, expected) => {
    expect(SecretFile.keepsModes(platform)).toBe(expected);
  });

  it.each([
    ["linux", 0o644, 0o644],
    ["linux", 0o600, undefined],
    ["win32", 0o644, undefined],
  ] as const)("on %s a %s file is loose as %s", async (platform, mode, expected) => {
    const file = join(await scratchDir("zitadel-secret-file-"), "secret");
    await writeFile(file, "x");
    await chmod(file, mode);

    expect(await SecretFile.looseMode(file, platform)).toBe(
      SecretFile.keepsModes() ? expected : undefined,
    );
  });

  it("relocks a loose file to 0600 where modes exist, and leaves it alone where they do not", async () => {
    const file = join(await scratchDir("zitadel-secret-file-"), "secret");
    await writeFile(file, "x");
    await chmod(file, 0o644);

    await SecretFile.relock(file, "win32");
    expect(await SecretFile.looseMode(file, "linux")).toBe(
      SecretFile.keepsModes() ? 0o644 : undefined,
    );

    await SecretFile.relock(file, "linux");
    expect(await SecretFile.looseMode(file, "linux")).toBeUndefined();
  });
});
