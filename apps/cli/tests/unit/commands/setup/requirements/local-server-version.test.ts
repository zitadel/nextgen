import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { localServerVersion } from "../../../../../src/commands/setup/requirements/local-server-version";
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

describe("localServerVersion", () => {
  it("finds nothing wrong where no local server was started", async () => {
    const cwd = await directory();

    await expect(
      localServerVersion.resolve(
        requirementContext({ meta: { cwd, source: "http://localhost:8080" } }),
      ),
    ).resolves.toBe(true);
  });

  it("is not asked of an app already set up", async () => {
    const cwd = await directory();
    await writeFile(join(cwd, "zitadel.json"), "{}");

    await expect(localServerVersion.resolve(requirementContext({ meta: { cwd } }))).resolves.toBe(
      true,
    );
  });

  it("refuses with the versions and the steps to take", () => {
    expect(localServerVersion.refusal).toMatchObject({
      code: "E_CONFLICT",
      message: "The local Zitadel server runs {running}, but this CLI ships {expected}",
      next: ["{start}", "{setup}"],
    });
  });
});
