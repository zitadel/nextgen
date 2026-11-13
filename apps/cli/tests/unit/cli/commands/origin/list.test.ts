import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HttpResponse, http } from "msw";
import { afterEach, describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";

import { parseJson, runCliForTest, stripAnsi } from "@tests/helpers/run-cli";
import { asTerminal } from "@tests/helpers/terminal";
import { PRIMARY_ORIGIN } from "@tests/helpers/records";

const SERVER = "https://api.zitadel.example";

type Origin = { pattern: string; kind: string };
const origins: Origin[] = [];

it.beforeEach(({ server }) => {
  origins.length = 0;
  server.use(
    http.get(`${SERVER}/api/v1/projects/:id`, ({ params }) =>
      HttpResponse.json({
        id: String(params.id),
        name: "demo",
        origins,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      }),
    ),
  );
});

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function anAppDir(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-origin-list-"));
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

function list(cwd: string, extra: string[] = []) {
  return runCliForTest(["origin", "list", ...extra, "--cwd", cwd, "--server", SERVER]);
}

/** Runs `run` with stdout reporting as a terminal, so the aligned table renders. */
describe("origin list", () => {
  it("returns the origins in the --json envelope", async () => {
    const cwd = await anAppDir();
    origins.push({ pattern: PRIMARY_ORIGIN, kind: "primary" });

    const result = await list(cwd, ["--json"]);

    expect(parseJson(result.stdout)).toMatchObject({
      data: { items: origins, count: 1, next_page_token: null },
    });
  });

  it("renders a pattern/kind table on a terminal", async () => {
    const cwd = await anAppDir();
    origins.push({ pattern: PRIMARY_ORIGIN, kind: "primary" });

    const result = await asTerminal(() => list(cwd));

    const text = stripAnsi(result.stdout);
    expect(text).toContain("pattern");
    expect(text).toContain("kind");
    expect(text).toContain(PRIMARY_ORIGIN);
    expect(text).toContain("1 origin");
  });

  it("says nothing was found in the words every list uses when it is empty", async () => {
    const cwd = await anAppDir();

    const result = await asTerminal(() => list(cwd));

    expect(stripAnsi(result.stdout)).toContain("No origins found");
  });

  it("prints tab-separated rows with no header when piped", async () => {
    const cwd = await anAppDir();
    origins.push({ pattern: PRIMARY_ORIGIN, kind: "primary" });

    const result = await list(cwd, ["--plain"]);

    expect(result.stdout.trim()).toBe(`${PRIMARY_ORIGIN}\tprimary`);
  });
});
