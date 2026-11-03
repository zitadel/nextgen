import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { zitadelProject } from "../../../../../src/lib/oclif/requires/zitadel-project";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

async function context(withConfig: boolean) {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-project-"));
  dirs.push(cwd);
  if (withConfig) {
    await writeFile(join(cwd, "zitadel.json"), "{}");
  }
  return {
    cwd,
    flags: {},
    args: {},
    meta: { cwd } as never,
    connect: () => Promise.reject(new Error("no connection")),
    resolved: {},
  };
}

describe("zitadelProject", () => {
  it("finds a directory that holds zitadel.json", async () => {
    const given = await context(true);

    await expect(zitadelProject.resolve(given)).resolves.toEqual({ cwd: given.cwd });
  });

  it("finds nothing in a directory that does not, and refuses with setup as the next step", async () => {
    await expect(zitadelProject.resolve(await context(false))).resolves.toBeUndefined();
    expect(zitadelProject.refusal).toMatchObject({
      message: "This directory is not a Zitadel project",
      next: ["setup"],
    });
  });
});
