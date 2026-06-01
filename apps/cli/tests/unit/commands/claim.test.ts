import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../../helpers/run-cli";

const BASE = "http://mock.zitadel.test";
const server = setupServer();

const SECRET = {
  project_id: "proj_001",
  project_secret: "sk_proj_old",
  preview_secret: "sk_proj_preview",
  preview_origins: [],
  lifecycle: "unclaimed",
  created_at: "2026-01-01T00:00:00.000Z",
};

const tempDirs: string[] = [];

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterAll(() => server.close());

afterEach(async () => {
  server.resetHandlers();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeProject(): Promise<string> {
  const cwd = join(tmpdir(), `zitadel-claim-test-${Math.random().toString(36).slice(2)}`);
  tempDirs.push(cwd);
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeFile(join(cwd, ".zitadel/secret"), `${JSON.stringify(SECRET, null, 2)}\n`);
  return cwd;
}

describe("claim command", () => {
  it("does not call the API or rewrite .zitadel/secret during dry-run", async () => {
    const cwd = await makeProject();

    const res = await runCliForTest([
      "claim",
      "--cwd",
      cwd,
      "--json",
      "--server",
      BASE,
      "--dry-run",
      "--challenge-id",
      "claim_001",
    ]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { status: string; data: { action: string } };
    expect(json.status).toBe("skipped");
    expect(json.data.action).toBe("poll_claim_status");
    await expect(readFile(join(cwd, ".zitadel/secret"), "utf8")).resolves.toBe(
      `${JSON.stringify(SECRET, null, 2)}\n`,
    );
  });

  it("starts a claim challenge and returns the human handoff URL", async () => {
    const cwd = await makeProject();
    let receivedAuth = "";
    let receivedBody: unknown;
    server.use(
      http.post(`${BASE}/projects/proj_001/claim/init`, async ({ request }) => {
        receivedAuth = request.headers.get("authorization") ?? "";
        receivedBody = await request.json();
        return HttpResponse.json(
          {
            project_id: "proj_001",
            challenge_id: "claim_001",
            claim_url: "https://zitadel.cloud/claim?challenge_id=claim_001",
            expires_at: "2026-01-01T00:10:00.000Z",
            status: "pending",
          },
          { status: 201 },
        );
      }),
    );

    const res = await runCliForTest([
      "claim",
      "--cwd",
      cwd,
      "--json",
      "--server",
      BASE,
      "--return-url",
      "https://example.com/return",
      "--team-name",
      "Acme",
    ]);

    expect(res.exitCode).toBe(0);
    expect(receivedAuth).toBe("Bearer sk_proj_old");
    expect(receivedBody).toEqual({
      return_url: "https://example.com/return",
      suggested_team_name: "Acme",
    });
    const json = parseJson(res.stdout) as {
      status: string;
      data: { challenge_id: string; claim_url: string; next_commands: string[] };
    };
    expect(json.status).toBe("ok");
    expect(json.data.challenge_id).toBe("claim_001");
    expect(json.data.claim_url).toContain("claim_001");
    expect(json.data.next_commands).toEqual(["zitadel claim --challenge-id claim_001"]);
  });

  it("rewrites .zitadel/secret atomically when claim status returns the rotated secret", async () => {
    const cwd = await makeProject();
    server.use(
      http.get(`${BASE}/projects/proj_001/claim/status`, ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer sk_proj_old");
        expect(new URL(request.url).searchParams.get("challenge_id")).toBe("claim_001");
        return HttpResponse.json({
          project_id: "proj_001",
          challenge_id: "claim_001",
          status: "completed",
          expires_at: "2026-01-01T00:10:00.000Z",
          claimed_at: "2026-01-01T00:05:00.000Z",
          rotated_project_secret: "sk_proj_new",
        });
      }),
    );

    const res = await runCliForTest([
      "claim",
      "--cwd",
      cwd,
      "--json",
      "--server",
      BASE,
      "--challenge-id",
      "claim_001",
    ]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: { status: string; secret_rotated: boolean };
    };
    expect(json.status).toBe("ok");
    expect(json.data).toMatchObject({ status: "claimed", secret_rotated: true });

    const updated = JSON.parse(await readFile(join(cwd, ".zitadel/secret"), "utf8")) as {
      project_secret: string;
      preview_secret: string;
      lifecycle: string;
      claimed_at: string;
    };
    expect(updated.project_secret).toBe("sk_proj_new");
    expect(updated.preview_secret).toBe("sk_proj_preview");
    expect(updated.lifecycle).toBe("claimed");
    expect(updated.claimed_at).toBe("2026-01-01T00:05:00.000Z");
  });
});
