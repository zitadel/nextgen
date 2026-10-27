import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { runCliForTest, stripAnsi } from "../../../helpers/run-cli";
import { asTerminal } from "../../../helpers/terminal";

const SERVER = "https://api.zitadel.cloud";
const server = setupServer();
const dirs: string[] = [];

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(async () => {
  server.resetHandlers();
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function aProject(origins: readonly string[]): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-deployment-create-"));
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
  server.use(
    http.post(`${SERVER}/deployments`, () =>
      HttpResponse.json({
        id: "dep_1",
        release_id: "rel_1",
        targets: origins.map((origin) => ({ origin, expires_at: null })),
        metadata: { reason: "deploy" },
        deployed_at: "2026-01-01T00:00:00.000Z",
      }),
    ),
  );
  return cwd;
}

const deploy = (cwd: string) =>
  asTerminal(() =>
    runCliForTest([
      "deployment",
      "create",
      "--release",
      "rel_1",
      "--cwd",
      cwd,
      "--server",
      SERVER,
      "--no-telemetry",
    ]),
  );

describe("deployment create", () => {
  it("answers with one clause, and never a list item spliced into the footer", async () => {
    const cwd = await aProject(["https://app.acme.com"]);

    const res = await deploy(cwd);

    expect(res.exitCode).toBe(0);
    const shown = stripAnsi(res.stdout);
    expect(shown).toContain("Deployed rel_1 to 1 origin · project proj_test");
    expect(shown).not.toContain("- https://app.acme.com");
  });

  it("counts the origins rather than spelling out as many as the project has", async () => {
    const cwd = await aProject(["https://app.acme.com", "https://admin.acme.com"]);

    const res = await deploy(cwd);

    const shown = stripAnsi(res.stdout);
    expect(shown).toContain("Deployed rel_1 to 2 origins");
    expect(shown).not.toContain("https://admin.acme.com");
  });
});
