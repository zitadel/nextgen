import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { project } from "../../../../../src/commands/branding/requirements/project";
import { requirementContext } from "../../../../helpers/requirement-context";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

async function directory(withConfig: boolean): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-project-"));
  dirs.push(cwd);
  if (withConfig) {
    await writeFile(join(cwd, "zitadel.json"), "{}");
  }
  return cwd;
}

describe("project", () => {
  it("finds a directory that holds zitadel.json", async () => {
    const cwd = await directory(true);

    await expect(project.resolve(requirementContext({ meta: { cwd } }))).resolves.toEqual({
      cwd,
    });
  });

  it("finds nothing in a directory that does not, and refuses with setup as the next step", async () => {
    const cwd = await directory(false);

    await expect(project.resolve(requirementContext({ meta: { cwd } }))).resolves.toBeUndefined();
    expect(project.refusal).toMatchObject({
      message: "This directory is not a Zitadel project",
      next: ["setup"],
    });
  });
});
