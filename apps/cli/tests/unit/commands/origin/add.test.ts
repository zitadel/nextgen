import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HttpResponse, http } from "msw";
import { afterEach, describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";

import { parseJson, runCliForTest } from "@tests/helpers/run-cli";
import { PRIMARY_ORIGIN, PREVIEW_PATTERN } from "@tests/helpers/records";

const SERVER = "https://api.zitadel.example";

const requests: Array<Record<string, unknown>> = [];

it.beforeEach(({ server }) => {
  requests.length = 0;
  server.use(
    http.post(`${SERVER}/api/v1/projects/:id/origins`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      requests.push(body);
      return HttpResponse.json(body, { status: 201 });
    }),
  );
});

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function anAppDir(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-origin-add-"));
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

async function add(cwd: string, ...extra: string[]) {
  const result = await runCliForTest([
    "origin",
    "add",
    ...extra,
    "--cwd",
    cwd,
    "--server",
    SERVER,
    "--json",
  ]);
  return {
    result,
    envelope: parseJson(result.stdout) as { data: Record<string, unknown>; code?: string },
  };
}

describe("origin add", () => {
  it("sends the pattern and kind to the project's origins endpoint", async () => {
    const cwd = await anAppDir();

    await add(cwd, PRIMARY_ORIGIN, "--kind", "primary");

    expect(requests).toEqual([{ pattern: PRIMARY_ORIGIN, kind: "primary" }]);
  });

  it("reports the stored pattern and kind", async () => {
    const cwd = await anAppDir();

    const { envelope } = await add(cwd, PREVIEW_PATTERN, "--kind", "preview");

    expect(envelope.data).toMatchObject({ pattern: PREVIEW_PATTERN, kind: "preview" });
  });

  it("requires --kind", async () => {
    const cwd = await anAppDir();

    const { result } = await add(cwd, PRIMARY_ORIGIN);

    expect(result.exitCode).not.toBe(0);
    expect(requests).toEqual([]);
  });

  it("rejects a kind that is neither primary nor preview", async () => {
    const cwd = await anAppDir();

    const { result } = await add(cwd, PRIMARY_ORIGIN, "--kind", "sandbox");

    expect(result.exitCode).not.toBe(0);
    expect(requests).toEqual([]);
  });

  it("makes no request on a dry run", async () => {
    const cwd = await anAppDir();

    const { result, envelope } = await add(cwd, PRIMARY_ORIGIN, "--kind", "primary", "--dry-run");

    expect(result.exitCode).toBe(0);
    expect(requests).toEqual([]);
    expect(envelope.data).toMatchObject({ dry_run: true, verb: "add", topic: "origin" });
  });

  it("keeps the active --env in the suggested next command", async () => {
    const cwd = await anAppDir();
    await writeFile(
      join(cwd, ".env.production.local"),
      "ZITADEL_PROJECT_ID=proj_unit\nZITADEL_PROJECT_SECRET=sk_unit\n",
    );

    const { envelope } = await add(cwd, PRIMARY_ORIGIN, "--kind", "primary", "--env", "production");

    expect((envelope.data.next_commands as string[])[0]).toContain("--env production");
  });
});
