import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { directory } from "../../../../../src/commands/setup/requirements/directory";
import { requirementContext } from "../../../../helpers/requirement-context";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

async function aDirectory(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-requirement-"));
  dirs.push(cwd);
  return cwd;
}

describe("directory", () => {
  it("accepts a directory and one that does not exist yet", async () => {
    const cwd = await aDirectory();

    await expect(directory.resolve(requirementContext({ meta: { cwd } }))).resolves.toBe(cwd);
    const fresh = join(cwd, "shop", "web");
    await expect(directory.resolve(requirementContext({ meta: { cwd: fresh } }))).resolves.toBe(
      fresh,
    );
  });

  it("refuses a file, and a path under one", async () => {
    const cwd = await aDirectory();
    const file = join(cwd, "notes.txt");
    await writeFile(file, "");

    await expect(
      directory.resolve(requirementContext({ meta: { cwd: file } })),
    ).resolves.toBeUndefined();
    await expect(
      directory.resolve(requirementContext({ meta: { cwd: join(file, "web") } })),
    ).resolves.toBeUndefined();
    expect(directory.refusal?.message).toBe("{cwd} is not a directory");
  });
});
