import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCliForTest, stripAnsi } from "../../../helpers/run-cli";
import { asTerminal } from "../../../helpers/terminal";

const SERVER = "https://api.zitadel.cloud";
const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** A project directory with no `.env.<name>.local` beside it, so nothing is bound. */
async function aProjectWithNothingBound(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-env-list-"));
  dirs.push(cwd);
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeFile(
    join(cwd, ".zitadel/secret"),
    JSON.stringify({
      project_id: "proj_test",
      project_secret: "sk_test",
      preview_secret: "pk_test",
      preview_origins: [],
      created_at: "2026-01-01T00:00:00.000Z",
    }),
  );
  return cwd;
}

const listed = async (cwd: string): Promise<string> => {
  const res = await asTerminal(() =>
    runCliForTest(["env", "list", "--cwd", cwd, "--server", SERVER, "--no-telemetry"]),
  );
  expect(res.exitCode).toBe(0);
  return stripAnsi(res.stdout);
};

describe("zitadel env list", () => {
  it("says nothing was found in the words every list uses when nothing is bound", async () => {
    const out = await listed(await aProjectWithNothingBound());

    expect(out).toContain("No environments found");
  });

  it("orders nobody about in that sentence", async () => {
    const out = await listed(await aProjectWithNothingBound());

    expect(out).not.toContain("Run ");
  });

  it("counts in the same nouns once something is bound", async () => {
    const cwd = await aProjectWithNothingBound();
    await writeFile(
      join(cwd, ".env.development.local"),
      `ZITADEL_URL=${SERVER}\nZITADEL_PROJECT_ID=proj_test\n`,
    );

    const out = await listed(cwd);

    expect(out).toContain("1 environment");
  });
});
