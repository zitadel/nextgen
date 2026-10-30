import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { onATerminal } from "../../../helpers/project";
import { runCliForTest } from "../../../helpers/run-cli";

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

const deployment = (id: string) => ({
  id,
  release_id: "rel_1",
  targets: [{ origin: "https://app.acme.com", expires_at: null }],
  metadata: { reason: "deploy" },
  deployed_at: "2026-01-01T00:00:00.000Z",
});

async function aProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-deployment-list-"));
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

const listed = (cwd: string) =>
  onATerminal(() =>
    runCliForTest([
      "deployment",
      "list",
      "--cwd",
      cwd,
      "--server",
      SERVER,
      "--non-interactive",
      "--no-telemetry",
    ]),
  );

describe("deployment list", () => {
  it("says the sentence every other list says when it finds nothing", async () => {
    const cwd = await aProject();
    server.use(
      http.get(`${SERVER}/deployments`, () =>
        HttpResponse.json({ deployments: [], next_page_token: null }),
      ),
    );

    const res = await listed(cwd);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("No deployments found ·");
  });

  it("counts what it found in the same words every other list counts in", async () => {
    const cwd = await aProject();
    server.use(
      http.get(`${SERVER}/deployments`, () =>
        HttpResponse.json({
          deployments: [deployment("dep_1"), deployment("dep_2")],
          next_page_token: null,
        }),
      ),
    );

    const res = await listed(cwd);

    expect(res.stdout).toContain("2 deployments");
  });
});
