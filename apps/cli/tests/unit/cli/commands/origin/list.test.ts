import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { HttpResponse, http } from "msw";
import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";

import { parseJson, runCliForTest, stripAnsi } from "@tests/helpers/run-cli";
import { asTerminal } from "@tests/fixtures/terminal";
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

async function anAppDir(cwd: string): Promise<string> {
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
  it("returns the origins in the --json envelope", async ({ dir }) => {
    const cwd = await anAppDir(dir);
    origins.push({ pattern: PRIMARY_ORIGIN, kind: "primary" });

    const result = await list(cwd, ["--json"]);

    expect(parseJson(result.stdout)).toMatchObject({
      data: { items: origins, count: 1, next_page_token: null },
    });
  });

  it("renders a pattern/kind table on a terminal", async ({ dir }) => {
    const cwd = await anAppDir(dir);
    origins.push({ pattern: PRIMARY_ORIGIN, kind: "primary" });

    const result = await asTerminal(() => list(cwd));

    const text = stripAnsi(result.stdout);
    expect(text).toContain("pattern");
    expect(text).toContain("kind");
    expect(text).toContain(PRIMARY_ORIGIN);
    expect(text).toContain("1 origin");
  });

  it("says nothing was found in the words every list uses when it is empty", async ({ dir }) => {
    const cwd = await anAppDir(dir);

    const result = await asTerminal(() => list(cwd));

    expect(stripAnsi(result.stdout)).toContain("No origins found");
  });

  it("prints tab-separated rows with no header when piped", async ({ dir }) => {
    const cwd = await anAppDir(dir);
    origins.push({ pattern: PRIMARY_ORIGIN, kind: "primary" });

    const result = await list(cwd, ["--plain"]);

    expect(result.stdout.trim()).toBe(`${PRIMARY_ORIGIN}\tprimary`);
  });
});
