import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";
import { parseJson, runCliForTest, stripAnsi } from "@tests/helpers/run-cli";
import { asTerminal } from "@tests/fixtures/terminal";

const SERVER = "https://api.zitadel.cloud";

/** A project directory with no `.env.<name>.local` beside it, so nothing is bound. */
async function aProjectWithNothingBound(cwd: string): Promise<string> {
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
  it("says nothing was found in the words every list uses when nothing is bound", async ({
    dir,
  }) => {
    const out = await listed(await aProjectWithNothingBound(dir));

    expect(out).toContain("No environments found");
  });

  it("points at env add in the envelope when nothing is bound", async ({ dir }) => {
    const cwd = await aProjectWithNothingBound(dir);

    const res = await runCliForTest([
      "env",
      "list",
      "--cwd",
      cwd,
      "--server",
      SERVER,
      "--no-telemetry",
      "--json",
    ]);

    expect(parseJson(res.stdout)).toMatchObject({
      data: { next_commands: [expect.stringContaining("env add '<name>'")] },
    });
  });

  it("orders nobody about in that sentence", async ({ dir }) => {
    const out = await listed(await aProjectWithNothingBound(dir));

    expect(out).not.toContain("Run ");
  });

  it("counts in the same nouns once something is bound", async ({ dir }) => {
    const cwd = await aProjectWithNothingBound(dir);
    await writeFile(
      join(cwd, ".env.development.local"),
      `ZITADEL_URL=${SERVER}\nZITADEL_PROJECT_ID=proj_test\n`,
    );

    const out = await listed(cwd);

    expect(out).toContain("1 environment");
  });
});
