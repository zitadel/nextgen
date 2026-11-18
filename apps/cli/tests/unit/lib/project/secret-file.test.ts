import { chmod, readdir, writeFile } from "node:fs/promises";
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
