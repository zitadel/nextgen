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

async function aProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-env-"));
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

const shown = async (): Promise<string> => {
  const cwd = await aProject();
  const res = await asTerminal(() =>
    runCliForTest(["env", "--cwd", cwd, "--server", SERVER, "--no-telemetry"]),
  );
  expect(res.exitCode).toBe(0);
  return stripAnsi(res.stdout);
};

describe("zitadel env", () => {
  it("ends on a footer, as every other command does", async () => {
    const out = await shown();

    // It opens no connection — reporting what resolves is its whole job — so
    // it was the one command whose answer had nothing under it.
    expect(out).toContain("Using the development environment");
  });

  it("names the project and server it resolved in that footer", async () => {
    const out = await shown();

    expect(out).toContain("· project proj_test on api.zitadel.cloud");
  });

  it("does not head its answer with a row that reads as a table", async () => {
    const out = await shown();

    // Two spaces made the headline look like a column row, so it was read as
    // part of the table under it and never became the closing sentence.
    expect(out).not.toContain("Environment  development");
  });
});
