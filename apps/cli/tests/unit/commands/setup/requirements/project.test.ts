import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { project } from "../../../../../src/commands/setup/requirements/project";
import { requirementContext } from "../../../../helpers/requirement-context";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

async function directory(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-requirement-"));
  dirs.push(cwd);
  return cwd;
}

describe("project", () => {
  it("finds a directory with no project", async () => {
    const cwd = await directory();

    await expect(project.resolve(requirementContext({ meta: { cwd } }))).resolves.toEqual({
      configured: false,
    });
  });

  it("finds a project setup already made", async () => {
    const cwd = await directory();
    await writeFile(join(cwd, "zitadel.json"), "{}");

    await expect(project.resolve(requirementContext({ meta: { cwd } }))).resolves.toEqual({
      configured: true,
    });
  });

  it("refuses a secret with no configuration to go with it", async () => {
    const cwd = await directory();
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/secret"), "{}");

    await expect(project.resolve(requirementContext({ meta: { cwd } }))).resolves.toBeUndefined();
    expect(project.refusal).toMatchObject({
      code: "E_CONFLICT",
      message: ".zitadel/secret exists without zitadel.json",
    });
  });
});
