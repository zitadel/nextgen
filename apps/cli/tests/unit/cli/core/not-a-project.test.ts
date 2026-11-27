import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { refuseOutsideProject } from "@/cli/core/not-a-project";
import { scratchDir } from "@tests/fixtures/scratch";

/** A reason a command gives for needing a project. */
const WHY = "the OAuth settings live under .zitadel/.";

describe("refuseOutsideProject", () => {
  it("refuses a directory without zitadel.json, with the command's reason and setup next", async () => {
    const cwd = await scratchDir("zitadel-not-a-project-");

    await expect(refuseOutsideProject(cwd, WHY)).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "This directory is not a Zitadel project",
      hint: `Run setup first; ${WHY}`,
      nextCommands: [{ id: "setup" }],
    });
  });

  it("lets a directory with zitadel.json through", async () => {
    const cwd = await scratchDir("zitadel-not-a-project-");
    await writeFile(join(cwd, "zitadel.json"), "{}");

    await expect(refuseOutsideProject(cwd, WHY)).resolves.toBeUndefined();
  });
});
