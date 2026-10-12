import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../../../helpers/run-cli";

const SERVER = "https://api.zitadel.example";
const server = setupServer();

let removed: Array<Record<string, unknown>> = [];

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

beforeEach(() => {
  removed = [];
  server.use(
    http.post(`${SERVER}/projects/:id/origins/remove`, async ({ request }) => {
      removed.push((await request.json()) as Record<string, unknown>);
      return new HttpResponse(null, { status: 204 });
    }),
  );
});

afterEach(() => server.resetHandlers());

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function anAppDir(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-origin-rm-"));
  dirs.push(cwd);
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeFile(join(cwd, "zitadel.json"), JSON.stringify({ framework: { id: "next" } }));
  await writeFile(
    join(cwd, ".zitadel/secret"),
    JSON.stringify({
      project_id: "proj_unit",
      project_secret: "sk_unit",
      preview_secret: "pk_unit",
      preview_origins: [],
      created_at: "2026-01-01T00:00:00.000Z",
    }),
  );
  return cwd;
}

function remove(cwd: string, extra: string[] = []) {
  return runCliForTest([
    "origin",
    "rm",
    "https://app.acme.com",
    ...extra,
    "--cwd",
    cwd,
    "--server",
    SERVER,
    "--json",
  ]);
}

describe("origin rm", () => {
  it("removes the pattern and reports it when forced", async () => {
    const cwd = await anAppDir();

    const result = await remove(cwd, ["--force"]);

    expect(result.exitCode).toBe(0);
    expect(removed).toEqual([{ pattern: "https://app.acme.com" }]);
    expect(parseJson(result.stdout)).toMatchObject({
      data: { pattern: "https://app.acme.com", removed: true },
    });
  });

  it("refuses without --force when non-interactive, and makes no request", async () => {
    const cwd = await anAppDir();

    const result = await remove(cwd);

    expect((parseJson(result.stdout) as { code: string }).code).toBe("E_VALIDATION");
    expect(removed).toEqual([]);
  });

  it("makes no request on a dry run", async () => {
    const cwd = await anAppDir();

    const result = await remove(cwd, ["--force", "--dry-run"]);

    expect(result.exitCode).toBe(0);
    expect(removed).toEqual([]);
  });

  it("keeps the active --env in the suggested retry command", async () => {
    const cwd = await anAppDir();

    const result = await remove(cwd, ["--env", "production"]);

    const envelope = parseJson(result.stdout) as { code: string; next_commands?: string[] };
    expect(envelope.code).toBe("E_VALIDATION");
    expect(envelope.next_commands?.[0]).toContain("--env production");
  });
});
