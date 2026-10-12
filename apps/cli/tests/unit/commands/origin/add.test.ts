import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../../../helpers/run-cli";

const SERVER = "https://api.zitadel.example";
const server = setupServer();

let requests: Array<Record<string, unknown>> = [];

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

beforeEach(() => {
  requests = [];
  server.use(
    http.post(`${SERVER}/projects/:id/origins`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      requests.push(body);
      return HttpResponse.json(body, { status: 201 });
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

    await add(cwd, "https://app.acme.com", "--kind", "primary");

    expect(requests).toEqual([{ pattern: "https://app.acme.com", kind: "primary" }]);
  });

  it("reports the stored pattern and kind", async () => {
    const cwd = await anAppDir();

    const { envelope } = await add(cwd, "https://*-acme.vercel.app", "--kind", "preview");

    expect(envelope.data).toMatchObject({ pattern: "https://*-acme.vercel.app", kind: "preview" });
  });

  it("requires --kind", async () => {
    const cwd = await anAppDir();

    const { result } = await add(cwd, "https://app.acme.com");

    expect(result.exitCode).not.toBe(0);
    expect(requests).toEqual([]);
  });

  it("rejects a kind that is neither primary nor preview", async () => {
    const cwd = await anAppDir();

    const { result } = await add(cwd, "https://app.acme.com", "--kind", "sandbox");

    expect(result.exitCode).not.toBe(0);
    expect(requests).toEqual([]);
  });

  it("makes no request on a dry run", async () => {
    const cwd = await anAppDir();

    const { result, envelope } = await add(
      cwd,
      "https://app.acme.com",
      "--kind",
      "primary",
      "--dry-run",
    );

    expect(result.exitCode).toBe(0);
    expect(requests).toEqual([]);
    expect(envelope.data).toMatchObject({ dry_run: true, verb: "add", topic: "origin" });
  });
});
