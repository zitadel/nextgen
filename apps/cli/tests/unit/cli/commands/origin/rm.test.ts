import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HttpResponse, http } from "msw";
import { afterEach, describe, expect } from "vitest";

import OriginRm from "@/cli/commands/origin/rm";
import { answering } from "@tests/helpers/keyboard";
import { it } from "@tests/helpers/fixtures";
import { asTerminal as asPerson } from "@tests/helpers/terminal";

import { parseJson, runCliForTest } from "@tests/helpers/run-cli";
import { runCommand } from "@tests/helpers/run-cli";

const SERVER = "https://api.zitadel.example";

const removed: Array<Record<string, unknown>> = [];

it.beforeEach(({ server }) => {
  removed.length = 0;
  server.use(
    http.post(`${SERVER}/api/v1/projects/:id/origins/remove`, async ({ request }) => {
      removed.push((await request.json()) as Record<string, unknown>);
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(`${SERVER}/api/v1/projects/:id`, ({ params }) =>
      HttpResponse.json({
        id: params.id,
        origins: [{ pattern: "https://other.acme.com", kind: "primary" }],
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
      data: { pattern: "https://app.acme.com", deleted: true },
    });
  });

  it("still reports the removal when the remaining origins cannot be read", async ({ server }) => {
    const cwd = await anAppDir();
    server.use(
      http.get(`${SERVER}/api/v1/projects/:id`, () =>
        HttpResponse.json({ code: "internal" }, { status: 500 }),
      ),
    );

    const result = await remove(cwd, ["--force"]);

    expect(result.exitCode).toBe(0);
    expect(parseJson(result.stdout)).toMatchObject({
      data: { pattern: "https://app.acme.com", deleted: true },
      warnings: [expect.stringContaining("remaining origins could not be read")],
    });
  });

  it("refuses without --force when non-interactive, and makes no request", async () => {
    const cwd = await anAppDir();

    const result = await remove(cwd);

    expect((parseJson(result.stdout) as { code: string }).code).toBe("E_CONFIRMATION_REQUIRED");
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
    await writeFile(
      join(cwd, ".env.production.local"),
      "ZITADEL_PROJECT_ID=proj_unit\nZITADEL_PROJECT_SECRET=sk_unit\n",
    );

    const result = await remove(cwd, ["--env", "production"]);

    const envelope = parseJson(result.stdout) as { code: string; next_commands?: string[] };
    expect(envelope.code).toBe("E_CONFIRMATION_REQUIRED");
    expect(envelope.next_commands?.[0]).toContain("--env production");
  });

  it("names the environment the last origin was removed from in how to add one back", async ({
    server,
  }) => {
    const cwd = await anAppDir();
    await writeFile(
      join(cwd, ".env.production.local"),
      "ZITADEL_PROJECT_ID=proj_unit\nZITADEL_PROJECT_SECRET=sk_unit\n",
    );
    server.use(
      http.get(`${SERVER}/api/v1/projects/:id`, ({ params }) =>
        HttpResponse.json({ id: params.id, origins: [] }),
      ),
    );

    const result = await remove(cwd, ["--env", "production", "--force"]);

    expect((parseJson(result.stdout) as { warnings?: string[] }).warnings).toEqual([
      expect.stringContaining("origin add '<your-app-url>' --kind primary --env production"),
    ]);
  });

  it("keeps a control character in the pattern as it was typed, in the question it carries as data", async () => {
    const cwd = await anAppDir();

    const result = await runCliForTest([
      "origin",
      "rm",
      "https://app\u001b[31m.acme.com",
      "--cwd",
      cwd,
      "--server",
      SERVER,
      "--non-interactive",
      "--json",
    ]);

    const envelope = parseJson(result.stdout) as { code: string; hint: string };
    expect(envelope.code).toBe("E_CONFIRMATION_REQUIRED");
    expect(envelope.hint).toContain("\u001b[31m");
  });

  it("quotes a wildcard pattern in the suggested retry, so the shell cannot expand it", async () => {
    const cwd = await anAppDir();

    const result = await runCliForTest([
      "origin",
      "rm",
      "https://*-acme.vercel.app",
      "--cwd",
      cwd,
      "--server",
      SERVER,
      "--non-interactive",
      "--json",
    ]);

    const envelope = parseJson(result.stdout) as { next_commands?: string[] };
    expect(envelope.next_commands?.[0]).toContain("origin rm 'https://*-acme.vercel.app' --force");
  });
});

describe("origin rm asked on a terminal", () => {
  const removingOn = async (serverUrl: string) => {
    const cwd = await anAppDir();
    const talk = answering(false);
    await asPerson(() =>
      runCommand(OriginRm, "origin:rm", [
        "https://app.acme.com",
        "--cwd",
        cwd,
        "--server",
        serverUrl,
      ]),
    );
    return talk;
  };

  it("asks whether to remove the pattern, naming the project and a remote server", async () => {
    const talk = await removingOn(SERVER);

    expect(talk.asked()).toEqual([
      "Remove https://app.acme.com from project proj_unit on api.zitadel.example?",
    ]);
  });

  it("spells out a control character in the pattern in the question it draws", async () => {
    const cwd = await anAppDir();
    const talk = answering(false);

    await asPerson(() => {
      return runCommand(OriginRm, "origin:rm", [
        "https://app\u001b[31m.acme.com",
        "--cwd",
        cwd,
        "--server",
        SERVER,
      ]);
    });

    expect(talk.asked()).toEqual([
      "Remove https://app\\x1b[31m.acme.com from project proj_unit on api.zitadel.example?",
    ]);
  });

  it("names a local server by its host and port", async () => {
    const talk = await removingOn("http://localhost:8112");

    expect(talk.asked()).toEqual([
      "Remove https://app.acme.com from project proj_unit on localhost:8112?",
    ]);
  });
});
