import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { environmentFile } from "../../../../../../src/commands/env/add/requirements/file";
import { unmet } from "../../../../../../src/lib/oclif/requirements";
import { makeProject } from "../../../../../helpers/local-project";
import { requirementContext } from "../../../../../helpers/requirement-context";

describe("environmentFile", () => {
  it("is the file an environment is written to", async () => {
    const cwd = await makeProject();

    expect(
      await environmentFile.resolve(
        requirementContext({ args: { name: "staging" }, meta: { cwd } }),
      ),
    ).toEqual({
      file: ".env.staging.local",
      path: join(cwd, ".env.staging.local"),
    });
  });

  it("is unmet when the file exists", async () => {
    const cwd = await makeProject();
    await writeFile(join(cwd, ".env.staging.local"), "");

    expect(
      await environmentFile.resolve(
        requirementContext({ args: { name: "staging" }, meta: { cwd } }),
      ),
    ).toEqual(unmet({ file: ".env.staging.local" }));
  });

  it("is the file when it exists and --force says it may be overwritten", async () => {
    const cwd = await makeProject();
    await writeFile(join(cwd, ".env.staging.local"), "");

    expect(
      await environmentFile.resolve(
        requirementContext({ args: { name: "staging" }, flags: { force: true }, meta: { cwd } }),
      ),
    ).toMatchObject({ file: ".env.staging.local" });
  });

  it("refuses an existing file as a conflict, naming --force", () => {
    expect(environmentFile.refusal).toEqual({
      code: "E_CONFLICT",
      message: "{file} already exists",
      hint: "Pass --force to overwrite it.",
    });
  });
});
