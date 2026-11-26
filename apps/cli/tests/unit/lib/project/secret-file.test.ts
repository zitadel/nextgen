import { chmod, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";

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

describe("Project.lockDown when the folder cannot be searched", () => {
  it("names EACCES", async () => {
    warnings.take();
    const locked = join(await scratchDir("zitadel-secret-file-"), "locked");
    await mkdir(locked);
    await writeFile(join(locked, "secret"), "x");
    await chmod(locked, 0o000);
    onTestFinished(async () => {
      await chmod(locked, 0o700);
    });

    await Project.lockDown(join(locked, "secret"), 0o600);

    expect(warnings.take()).toEqual([expect.stringContaining("could not set it to 0600 (EACCES)")]);
  });
});

describe("SecretFile.isSecure", () => {
  it("is true for an owner-only file", async () => {
    const file = join(await scratchDir("zitadel-secret-file-"), "secret");
    await writeFile(file, "x");
    await chmod(file, 0o600);

    expect(await SecretFile.isSecure(file)).toBe(true);
  });

  it("leaves nothing behind beside the file", async () => {
    const dir = await scratchDir("zitadel-secret-file-");
    const file = join(dir, "secret");
    await writeFile(file, "x");
    await chmod(file, 0o644);

    await SecretFile.isSecure(file);

    expect(await readdir(dir)).toEqual(["secret"]);
  });

  it("is true again once the file is secured", async () => {
    const file = join(await scratchDir("zitadel-secret-file-"), "secret");
    await writeFile(file, "x");
    await chmod(file, 0o644);

    await SecretFile.secure(file);

    expect(await SecretFile.isSecure(file)).toBe(true);
  });
});
