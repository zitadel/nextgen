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

  it("leaves nothing behind in the temp directory", async () => {
    const tmp = await scratchDir("zitadel-secret-file-tmp-");
    const file = join(await scratchDir("zitadel-secret-file-"), "secret");
    await writeFile(file, "x");
    await chmod(file, 0o644);
    const names = ["TMPDIR", "TEMP", "TMP"] as const;
    const saved = names.map((name) => {
      return process.env[name];
    });
    for (const name of names) {
      process.env[name] = tmp;
    }

    try {
      await SecretFile.isSecure(file);
    } finally {
      names.forEach((name, index) => {
        const value = saved[index];
        if (value === undefined) {
          Reflect.deleteProperty(process.env, name);
        } else {
          process.env[name] = value;
        }
      });
    }

    expect(await readdir(tmp)).toEqual([]);
  });

  it("is true again once the file is secured", async () => {
    const file = join(await scratchDir("zitadel-secret-file-"), "secret");
    await writeFile(file, "x");
    await chmod(file, 0o644);

    await SecretFile.secure(file);

    expect(await SecretFile.isSecure(file)).toBe(true);
  });
});
