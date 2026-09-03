import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  completeClaimChallenge,
  expireClaimChallenge,
  resetPlatformStore,
  setupPlatformHandlers,
  snapshotPlatformStore,
} from "@zitadel/api-mock/platform";
import { http, passthrough } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  localContainerName,
  localRuntimePaths,
  writeRuntimeMetadata,
  type RuntimeMetadata,
} from "../../../src/lib/local-server/runtime";
import { parseJson, runCliForTest } from "../../helpers/run-cli";

/**
 * `zitadel claim` against the api-mock, which is the only working claim
 * backend until the server handler lands. The browser leg is driven directly
 * through the mock's `completeClaimChallenge` mutator: the real
 * `claim/complete` route is cookie-authenticated and Express-only, so it is
 * not reachable through msw handlers.
 */
const SERVER = "https://api.zitadel.cloud";
const server = setupServer(...setupPlatformHandlers());
const tempDirs: string[] = [];
const servers: Server[] = [];

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

afterEach(async () => {
  server.resetHandlers();
  resetPlatformStore();
  for (const httpServer of servers.splice(0)) {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

type Project = { id: string; project_secret: string };

/**
 * Seeds a project through the mock's own create endpoint (msw intercepts the
 * fetch), then lays down the `.zitadel/secret` a real `setup` would have
 * written. Going through the API rather than poking the store keeps the
 * project secret and the store in agreement, which `claim/init` checks.
 */
async function makeProject(overrides: Record<string, unknown> = {}): Promise<{
  cwd: string;
  project: Project;
}> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-claim-"));
  tempDirs.push(cwd);

  const response = await fetch(`${SERVER}/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "demo", preview_origins: [] }),
  });
  const project = (await response.json()) as Project;
  // Fail loudly rather than writing `undefined` into the secret: a renamed
  // wire field would otherwise surface as an unrelated "missing required
  // fields" error from deep inside the command under test.
  if (typeof project.project_secret !== "string") {
    throw new Error(`mock POST /projects returned no project_secret: ${JSON.stringify(project)}`);
  }

  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeSecret(cwd, {
    project_id: project.id,
    project_secret: project.project_secret,
    preview_secret: "sk_preview_test",
    preview_origins: [],
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
  return { cwd, project };
}

async function writeSecret(cwd: string, secret: Record<string, unknown>): Promise<void> {
  await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(secret), { mode: 0o600 });
}

async function readSecret(cwd: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(cwd, ".zitadel/secret"), "utf8")) as Record<string,
    unknown>;
}

function claim(cwd: string, extra: string[] = []) {
  return runCliForTest(["claim", "--cwd", cwd, "--json", "--server", SERVER, ...extra]);
}

/**
 * Waits for the CLI's `claim/init` to reach the mock, then plays the browser
 * leg. The challenge id only exists inside the store — the CLI keeps the
 * response body to itself — so the store snapshot is how a test learns it.
 */
async function onChallengeMinted(act: (challengeId: string) => void): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [challengeId] = snapshotPlatformStore().claimChallengeIds;
    if (challengeId) {
      act(challengeId);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("claim/init was never called");
}

describe("claim", () => {
  it("attaches the project to a team and records it in .zitadel/secret", async () => {
    const { cwd, project } = await makeProject();

    const [res] = await Promise.all([
      claim(cwd),
      onChallengeMinted((challengeId) => completeClaimChallenge(challengeId, project.id)),
    ]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: { project_id: string; team_id: string; claimed_at: string; dashboard_url: string };
    };
    expect(json.status).toBe("ok");
    expect(json.data.project_id).toBe(project.id);
    expect(json.data.team_id).toMatch(/^team-/);
    expect(json.data.dashboard_url).toContain(json.data.team_id);

    const secret = await readSecret(cwd);
    expect(secret.team_id).toBe(json.data.team_id);
    expect(secret.claimed_at).toBe(json.data.claimed_at);
    // Claiming attaches ownership; it must not rotate the credentials the
    // running app is already using.
    expect(secret.project_secret).toBe(project.project_secret);
    expect(secret.preview_secret).toBe("sk_preview_test");
  });

  it("prints the link so a user can open it themselves", async () => {
    const { cwd, project } = await makeProject();

    // No `--json`: the envelope silences consola, and the point here is the
    // human-facing narration that carries the link.
    const [res] = await Promise.all([
      runCliForTest(["claim", "--cwd", cwd, "--server", SERVER, "--no-open"]),
      onChallengeMinted((challengeId) => completeClaimChallenge(challengeId, project.id)),
    ]);

    expect(res.exitCode).toBe(0);
    expect(`${res.stdout}${res.stderr}`).toContain("/claim/ch_");
  });

  // The agent contract mandates `--json`, which silences consola — and the
  // link is the one thing the human needs from this command. It has to reach
  // them somewhere, and stderr is the only stream the envelope leaves free.
  it("surfaces the link on stderr under --json, keeping stdout to the envelope", async () => {
    const { cwd, project } = await makeProject();

    const [res] = await Promise.all([
      claim(cwd, ["--no-open"]),
      onChallengeMinted((challengeId) => completeClaimChallenge(challengeId, project.id)),
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toContain("Finish in your browser: ");
    expect(res.stderr).toContain("/claim/ch_");
    expect(res.stderr).toContain("The link expires at ");
    expect(res.stdout).not.toContain("/claim/ch_");
    const json = parseJson(res.stdout) as { status: string };
    expect(json.status).toBe("ok");
  });

  it("skips without a network call when the secret already records a team", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-claim-"));
    tempDirs.push(cwd);
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeSecret(cwd, {
      project_id: "proj-local",
      project_secret: "sk_proj_local",
      preview_secret: "sk_preview_local",
      preview_origins: [],
      created_at: "2026-01-01T00:00:00.000Z",
      claimed_at: "2026-02-02T00:00:00.000Z",
      team_id: "team-local",
    });

    const res = await claim(cwd);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { status: string; reason: string; data: unknown };
    expect(json.status).toBe("skipped");
    expect(json.reason).toBe("already-claimed");
    expect(json.data).toMatchObject({ project_id: "proj-local", team_id: "team-local" });
    // The project was never created in the mock, so any request would have
    // 401'd. Reaching a clean skip proves nothing was sent.
    expect(snapshotPlatformStore().claimChallengeIds).toEqual([]);
  });

  it("reports the owning team when the platform says it is already claimed", async () => {
    const { cwd, project } = await makeProject();
    await Promise.all([
      claim(cwd),
      onChallengeMinted((challengeId) => completeClaimChallenge(challengeId, project.id)),
    ]);
    const claimed = await readSecret(cwd);

    // Drop the local record so the command has to learn it from the 409.
    const { claimed_at: _claimedAt, team_id: _teamId, ...withoutClaim } = claimed;
    await writeSecret(cwd, withoutClaim);

    const res = await claim(cwd);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      reason: string;
      data: { team_id: string; dashboard_url: string };
    };
    expect(json.status).toBe("skipped");
    expect(json.reason).toBe("already-claimed");
    expect(json.data.team_id).toBe(claimed.team_id);
    expect(json.data.dashboard_url).toContain(String(claimed.team_id));
  });

  it("fails with actionable guidance when the link expires", async () => {
    const { cwd } = await makeProject();

    const [res] = await Promise.all([
      claim(cwd),
      onChallengeMinted((challengeId) => expireClaimChallenge(challengeId)),
    ]);

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as {
      status: string;
      code: string;
      message: string;
      next_commands: string[];
    };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("expired");
    expect(json.next_commands.some((command) => command.includes("claim"))).toBe(true);

    // A failed claim must leave the secret exactly as it was.
    const secret = await readSecret(cwd);
    expect(secret.claimed_at).toBeUndefined();
    expect(secret.team_id).toBeUndefined();
  });

  it("stops waiting at --timeout and leaves the secret untouched", async () => {
    const { cwd } = await makeProject();

    const res = await claim(cwd, ["--timeout", "2"]);

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { status: string; code: string; message: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("Stopped waiting");
    expect((await readSecret(cwd)).team_id).toBeUndefined();
  });

  it("mutates neither the platform nor the secret under --dry-run", async () => {
    const { cwd } = await makeProject();

    const res = await claim(cwd, ["--dry-run"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { status: string; reason: string; data: unknown };
    expect(json.status).toBe("skipped");
    expect(json.reason).toBe("dry-run");
    expect(json.data).toMatchObject({ project_id: expect.stringMatching(/^proj-/) });

    // The whole point: no challenge was minted, so a developer who wandered
    // into the browser could not have claimed the project behind this run's
    // back and left the local file disagreeing with the platform.
    expect(snapshotPlatformStore().claimChallengeIds).toEqual([]);
    expect(snapshotPlatformStore().claims).toBe(0);
    expect((await readSecret(cwd)).team_id).toBeUndefined();
  });

  describe("--server local", () => {
    // These talk to a real socket on an ephemeral port. msw's platform
    // handlers match any origin, so they would otherwise swallow the stub's
    // claim routes and `onUnhandledRequest: "error"` would reject `/healthz`.
    beforeEach(() => {
      server.use(http.all(/^http:\/\/localhost:\d+\//, () => passthrough()));
    });

    it("points at `zitadel start` when no local runtime is reachable", async () => {
      const { cwd } = await makeProject();
      await writeRuntimeMetadata(cwd, runtimeFor(cwd, "http://localhost:9"));

      const res = await runCliForTest(["claim", "--cwd", cwd, "--json", "--server", "local"]);

      expect(res.exitCode).toBe(4);
      const json = parseJson(res.stdout) as { status: string; code: string };
      expect(json.status).toBe("error");
      expect(json.code).toBe("E_LOCAL_SERVER_NOT_RUNNING");
    });

    it("claims against the resolved local server", async () => {
      const { cwd } = await makeProject();
      const serverUrl = await startClaimServer();
      await writeRuntimeMetadata(cwd, runtimeFor(cwd, serverUrl));

      const res = await runCliForTest([
        "claim",
        "--cwd",
        cwd,
        "--json",
        "--server",
        "local",
        "--no-open",
      ]);

      expect(res.exitCode).toBe(0);
      const json = parseJson(res.stdout) as { status: string; source: string; data: unknown };
      expect(json.status).toBe("ok");
      expect(json.source).toBe(serverUrl);
      expect(json.data).toMatchObject({ team_id: "team-local-stub" });
      expect((await readSecret(cwd)).team_id).toBe("team-local-stub");
    });

    // No `--json` in the next two: the warning is consola narration, and the
    // envelope silences it.
    it("warns when a local server advertises a remote claim page", async () => {
      const { cwd } = await makeProject();
      const serverUrl = await startClaimServer(
        "https://nextgen.zitadel.cloud/ui/console/claim?challenge_id=ch_localstub",
      );
      await writeRuntimeMetadata(cwd, runtimeFor(cwd, serverUrl));

      const res = await runCliForTest(["claim", "--cwd", cwd, "--server", "local", "--no-open"]);

      expect(res.exitCode).toBe(0);
      expect(`${res.stdout}${res.stderr}`).toContain("NEXTGEN_SERVER_PUBLIC_BASE");
    });

    // Under `--json` the warning would otherwise be silenced with the rest of
    // consola, but an agent is exactly who needs to learn that the link it is
    // about to forward points at the wrong origin.
    it("keeps the warning on stderr under --json", async () => {
      const { cwd } = await makeProject();
      const serverUrl = await startClaimServer(
        "https://nextgen.zitadel.cloud/ui/console/claim?challenge_id=ch_localstub",
      );
      await writeRuntimeMetadata(cwd, runtimeFor(cwd, serverUrl));

      const res = await runCliForTest([
        "claim",
        "--cwd",
        cwd,
        "--json",
        "--server",
        "local",
        "--no-open",
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toContain("NEXTGEN_SERVER_PUBLIC_BASE");
      expect(res.stdout).not.toContain("NEXTGEN_SERVER_PUBLIC_BASE");
      expect((parseJson(res.stdout) as { status: string }).status).toBe("ok");
    });

    it("does not warn when the claim page is on the local server itself", async () => {
      const { cwd } = await makeProject();
      const serverUrl = await startClaimServer();
      await writeRuntimeMetadata(cwd, runtimeFor(cwd, serverUrl));

      const res = await runCliForTest(["claim", "--cwd", cwd, "--server", "local", "--no-open"]);

      expect(res.exitCode).toBe(0);
      expect(`${res.stdout}${res.stderr}`).not.toContain("advertised a claim page");
    });
  });
});

/**
 * A minimal stand-in for a local Zitadel server: enough of `/healthz` for
 * `resolveLocalServer` to accept it, and a claim pair that completes on the
 * first poll. msw is bypassed here because the request goes to localhost with
 * a port only known at runtime; a real socket is simpler than reshaping the
 * handlers.
 */
async function startClaimServer(
  claimUrl = "http://localhost/claim/ch_localstub",
): Promise<string> {
  const httpServer = createServer((req, res) => {
    const url = req.url ?? "";
    if (url === "/healthz") {
      res.writeHead(200).end("ok");
      return;
    }
    if (url.endsWith("/claim/init")) {
      res.writeHead(201, { "content-type": "application/json" }).end(
        JSON.stringify({
          claim_url: claimUrl,
          challenge_id: "ch_localstub",
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        }),
      );
      return;
    }
    if (url.includes("/claim/status")) {
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          status: "completed",
          team_id: "team-local-stub",
          claimed_at: "2026-03-03T00:00:00.000Z",
          dashboard_url: "http://localhost/teams/team-local-stub",
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  servers.push(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, "localhost", () => resolve()));
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("claim server did not expose a TCP address");
  }
  return `http://localhost:${String(address.port)}`;
}

function runtimeFor(cwd: string, serverUrl: string): RuntimeMetadata {
  return {
    schema_version: 1,
    backend: "docker",
    container_name: localContainerName(cwd),
    container_id: "container-test-id",
    image: "ghcr.io/zitadel/nextgen:test",
    port: Number(new URL(serverUrl).port),
    server_url: serverUrl,
    data_dir: localRuntimePaths(cwd).dataDir,
    created_at: "2026-06-09T00:00:00.000Z",
    cli_version: "0.0.0-test",
  };
}
