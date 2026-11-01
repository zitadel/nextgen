import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { parseJson, runCliForTest, stripAnsi } from "../../../helpers/run-cli";

const SERVER = "https://api.zitadel.example";
const server = setupServer();

type Origin = { pattern: string; kind: string };
let origins: Origin[] = [];

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

beforeEach(() => {
  origins = [];
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

afterEach(() => server.resetHandlers());

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
async function onATerminal<T>(run: () => Promise<T>): Promise<T> {
  const original = process.stdout.isTTY;
  process.stdout.isTTY = true;
  try {
    return await run();
  } finally {
    process.stdout.isTTY = original;
  }
}

describe("origin list", () => {
  it("returns the origins in the --json envelope", async () => {
    const cwd = await anAppDir();
    origins = [{ pattern: "https://app.acme.com", kind: "primary" }];

    const result = await list(cwd, ["--json"]);

    expect(parseJson(result.stdout)).toMatchObject({
      data: { items: origins, count: 1, next_page_token: null },
    });
  });

  it("renders a pattern/kind table on a terminal", async () => {
    const cwd = await anAppDir();
    origins = [{ pattern: "https://app.acme.com", kind: "primary" }];

    const result = await onATerminal(() => list(cwd));

    const text = stripAnsi(result.stdout);
    expect(text).toContain("pattern");
    expect(text).toContain("kind");
    expect(text).toContain("https://app.acme.com");
    expect(text).toContain("1 origin");
  });

  it("says the project has no origins when the list is empty", async () => {
    const cwd = await anAppDir();

    const result = await onATerminal(() => list(cwd));

    expect(stripAnsi(result.stdout)).toContain("No origins on the project.");
  });

  it("prints tab-separated rows with no header when piped", async () => {
    const cwd = await anAppDir();
    origins = [{ pattern: "https://app.acme.com", kind: "primary" }];

    const result = await list(cwd, ["--plain"]);

    expect(result.stdout.trim()).toBe("https://app.acme.com\tprimary");
  });
});
