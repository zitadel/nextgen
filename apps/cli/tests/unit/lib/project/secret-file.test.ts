import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { warnings } from "@/lib/ui";
import { Project } from "@/lib/project";
import { scratchDir } from "@tests/helpers/scratch";

describe("Project.lockDown", () => {
  it("warns instead of throwing when the mode cannot be applied", async () => {
    warnings.take();
    const missing = join(await scratchDir("zitadel-secret-file-"), "gone");

    await expect(Project.lockDown(missing, 0o600)).resolves.toBeUndefined();

    expect(warnings.take()).toEqual([expect.stringContaining("could not set it to 0600 (ENOENT)")]);
  });
});
