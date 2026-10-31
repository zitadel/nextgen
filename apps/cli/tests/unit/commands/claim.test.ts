import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  completeClaimChallenge,
  expireClaimChallenge,
  expireClaimWindow,
  resetPlatformStore,
  setupPlatformHandlers,
  snapshotPlatformStore,
} from "@zitadel/api-mock/platform";
import { http, passthrough } from "msw";
import { setupServer } from "msw/node";
import { text } from "@clack/prompts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  localRuntimePaths,
  writeRuntimeMetadata,
  type RuntimeMetadata,
} from "../../../src/lib/local-server/runtime";
import Claim from "../../../src/commands/claim";
import { parseJson, runCliForTest } from "../../helpers/run-cli";
import { asTerminal } from "../../helpers/terminal";

vi.mock("@clack/prompts", async () => (await import("../../helpers/clack")).clackDouble());
import { aBinaryRecord } from "../../helpers/runtime-record";

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
/**
 * Creates a project through the mock's own create endpoint (msw intercepts the
 * fetch) so its secret and the store agree — `claim/init` checks that.
 */
async function createProjectOnMock(): Promise<Project> {
  const response = await fetch(`${SERVER}/api/v1/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "demo", origins: [] }),
  });
  const project = (await response.json()) as Project;
  // Fail loudly rather than writing `undefined` into the secret: a renamed
  // wire field would otherwise surface as an unrelated "missing required
  // fields" error from deep inside the command under test.
  if (typeof project.project_secret !== "string") {
    throw new Error(`mock POST /projects returned no project_secret: ${JSON.stringify(project)}`);
  }
  return project;
}

async function makeProject(overrides: Record<string, unknown> = {}): Promise<{
  cwd: string;
  project: Project;
}> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-claim-"));
  tempDirs.push(cwd);

  const project = await createProjectOnMock();

  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeSecret(cwd, {
    project_id: project.id,
    project_secret: project.project_secret,
    preview_secret: "sk_preview_test",
    primary_origins: [],
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
  return JSON.parse(await readFile(join(cwd, ".zitadel/secret"), "utf8")) as Record<
    string,
    unknown
  >;
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
  // Generous: the first run in a file loads the CLI cold, which on a loaded
  // machine can take seconds before the request goes out.
  const deadline = Date.now() + 15_000;
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
      data: {
        title: string;
        project_id: string;
        team_id: string;
        claimed_at: string;
        dashboard_url: string;
        next_actions: string[];
      };
    };
    expect(json.status).toBe("ok");
    expect(json.data.project_id).toBe(project.id);
    expect(json.data.team_id).toMatch(/^team-/);
    expect(json.data.dashboard_url).toContain(json.data.team_id);
    // The human output speaks permanence and points at the Console; the team
    // id stays available here in the envelope.
    expect(json.data.title).toBe("Your Project is now permanent.");
    expect(json.data.next_actions).toEqual([
      "Manage your Project and collaborate in the Console:",
      json.data.dashboard_url,
    ]);

    const secret = await readSecret(cwd);
    expect(secret.team_id).toBe(json.data.team_id);
    expect(secret.claimed_at).toBe(json.data.claimed_at);
    // Claiming attaches ownership; it must not rotate the credentials the
    // running app is already using.
    expect(secret.project_secret).toBe(project.project_secret);
    expect(secret.preview_secret).toBe("sk_preview_test");
  });

  it("prints the link and the permanence outcome, without team wording", async () => {
    const { cwd, project } = await makeProject();

    // No `--json`: the envelope silences consola, and the point here is the
    // human-facing narration — the link on its own line, then the success
    // block in claim/permanence terms.
    const [res] = await Promise.all([
      runCliForTest(["claim", "--cwd", cwd, "--server", SERVER, "--no-open"]),
      onChallengeMinted((challengeId) => completeClaimChallenge(challengeId, project.id)),
    ]);

    expect(res.exitCode).toBe(0);
    const output = `${res.stdout}${res.stderr}`;
    expect(output).toContain("/claim/ch_");
    expect(output).toContain("Project claimed");
    expect(output).toContain("Your Project is now permanent.");
    expect(output).toContain("Manage your Project and collaborate in the Console:");
    // The team stays in the envelope and the secret, not in the prose. The
    // mock's dashboard_url embeds the team id in its path, so assert on the
    // retired sentence rather than on the raw id.
    expect(output).not.toContain("attached to team");
  });

  it("skips without a network call when the secret already records a team", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-claim-"));
    tempDirs.push(cwd);
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeSecret(cwd, {
      project_id: "proj-local",
      project_secret: "sk_proj_local",
      preview_secret: "sk_preview_local",
      primary_origins: [],
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

  it("explains a closed claim window without suggesting a retry", async () => {
    const { cwd, project } = await makeProject();
    expireClaimWindow(project.id);

    const res = await claim(cwd);

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as {
      status: string;
      code: string;
      message: string;
      next_commands?: string[];
    };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("14 days");
    expect(json.message).toContain("no longer be claimed");
    // The retryable expiry suggests `claim` again; a closed window must not,
    // because a fresh link cannot reopen it.
    expect((json.next_commands ?? []).some((command) => command.includes("claim"))).toBe(false);

    const secret = await readSecret(cwd);
    expect(secret.claimed_at).toBeUndefined();
    expect(secret.team_id).toBeUndefined();
  });

  // A challenge minted in the window's last minutes outlives it: the poll
  // must then surface the same non-retryable refusal as init, not the
  // "start a new link" advice a fresh challenge cannot honor.
  it("maps a window that closes mid-poll to the non-retryable explanation", async () => {
    const { cwd, project } = await makeProject();

    const [res] = await Promise.all([
      claim(cwd),
      onChallengeMinted(() => expireClaimWindow(project.id)),
    ]);

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as {
      status: string;
      code: string;
      message: string;
      next_commands?: string[];
    };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("14 days");
    expect(json.message).toContain("no longer be claimed");
    expect((json.next_commands ?? []).some((command) => command.includes("claim"))).toBe(false);

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

  it("claims the project the resolved environment names, not the fallback secret", async () => {
    const { cwd, project: fallback } = await makeProject();
    const envProject = await createProjectOnMock();
    await writeFile(
      join(cwd, ".env.production.local"),
      [
        `ZITADEL_URL=${SERVER}`,
        `ZITADEL_PROJECT_ID=${envProject.id}`,
        `ZITADEL_PROJECT_SECRET=${envProject.project_secret}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );

    const [res] = await Promise.all([
      claim(cwd, ["--env", "production"]),
      onChallengeMinted((challengeId) => completeClaimChallenge(challengeId, envProject.id)),
    ]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { status: string; data: { project_id: string } };
    expect(json.status).toBe("ok");
    expect(json.data.project_id).toBe(envProject.id);
    // The fallback `.zitadel/secret` describes a different project, so it must
    // not be marked claimed — that would conflate the two environments.
    const secret = await readSecret(cwd);
    expect(secret.project_id).toBe(fallback.id);
    expect(secret.team_id).toBeUndefined();
    expect(secret.claimed_at).toBeUndefined();
  });

  it("asks for a missing project id on a terminal and keeps the answer", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-claim-"));
    tempDirs.push(cwd);
    const envProject = await createProjectOnMock();
    await writeFile(
      join(cwd, ".env.production.local"),
      [`ZITADEL_URL=${SERVER}`, `ZITADEL_PROJECT_SECRET=${envProject.project_secret}`, ""].join(
        "\n",
      ),
      { mode: 0o600 },
    );
    vi.mocked(text).mockResolvedValueOnce(envProject.id);

    // The built CLI bundles its own prompts, so a prompt can only be answered
    // by running the command from source, where `input` is the one module asked.
    await Promise.all([
      asTerminal(() => Claim.run(["--cwd", cwd, "--no-open", "--env", "production"])),
      onChallengeMinted((challengeId) => completeClaimChallenge(challengeId, envProject.id)),
    ]);

    expect(await readFile(join(cwd, ".env.production.local"), "utf8")).toContain(
      `ZITADEL_PROJECT_ID=${envProject.id}`,
    );
  });

  it("claims from an env file with no local secret present", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-claim-"));
    tempDirs.push(cwd);
    const envProject = await createProjectOnMock();
    const file = join(cwd, "prod.env");
    await writeFile(
      file,
      [
        `ZITADEL_URL=${SERVER}`,
        `ZITADEL_PROJECT_ID=${envProject.id}`,
        `ZITADEL_PROJECT_SECRET=${envProject.project_secret}`,
        "",
      ].join("\n"),
    );

    const [res] = await Promise.all([
      runCliForTest(["claim", "--cwd", cwd, "--json", "--no-open", "--env-file", file]),
      onChallengeMinted((challengeId) => completeClaimChallenge(challengeId, envProject.id)),
    ]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { status: string; data: { project_id: string } };
    expect(json.status).toBe("ok");
    expect(json.data.project_id).toBe(envProject.id);
  });

  describe("--no-wait", () => {
    type LinkEnvelope = {
      status: string;
      data: {
        title: string;
        project_id: string;
        claim_url: string;
        challenge_id: string;
        expires_at: string;
        next_actions: string[];
        next_commands: string[];
      };
    };

    it("returns the link and the command that waits for it, without waiting", async () => {
      const { cwd, project } = await makeProject();

      const res = await claim(cwd, ["--no-wait"]);

      expect(res.exitCode).toBe(0);
      const json = parseJson(res.stdout) as LinkEnvelope;
      expect(json.status).toBe("ok");
      expect(json.data.title).toBe("Open the link in a browser to make your Project permanent.");
      expect(json.data.project_id).toBe(project.id);
      expect(json.data.challenge_id).toMatch(/^ch_/);
      expect(json.data.claim_url).toContain(`/claim/${json.data.challenge_id}`);
      expect(Number.isNaN(Date.parse(json.data.expires_at))).toBe(false);
      expect(json.data.next_actions).toEqual(["Wait for the browser step to finish with:"]);
      // The resume keeps this run's server and directory, or it would wait on
      // the default project instead.
      expect(json.data.next_commands).toEqual([
        expect.stringMatching(
          new RegExp(`claim --challenge-id ${json.data.challenge_id} --server ${SERVER} --cwd `),
        ),
      ]);
    });

    it("claims nothing and leaves the secret untouched", async () => {
      const { cwd } = await makeProject();

      await claim(cwd, ["--no-wait"]);

      expect(snapshotPlatformStore().claims).toBe(0);
      const secret = await readSecret(cwd);
      expect(secret.team_id).toBeUndefined();
      expect(secret.claimed_at).toBeUndefined();
    });

    it("prints the link and the resume command for a person", async () => {
      const { cwd } = await makeProject();

      const res = await runCliForTest(["claim", "--cwd", cwd, "--server", SERVER, "--no-wait"]);

      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain("/claim/ch_");
      expect(res.stdout).toContain("Wait for the browser step to finish with:");
      expect(res.stdout).toContain("claim --challenge-id ch_");
    });

    it("refuses --timeout, which a run that does not wait cannot honour", async () => {
      const { cwd } = await makeProject();

      const res = await claim(cwd, ["--no-wait", "--timeout", "5"]);

      expect(res.exitCode).not.toBe(0);
      expect(snapshotPlatformStore().claimChallengeIds).toEqual([]);
    });

    it("previews a link under --dry-run and suggests the same mode for real", async () => {
      const { cwd } = await makeProject();

      const res = await claim(cwd, ["--no-wait", "--dry-run"]);

      const json = parseJson(res.stdout) as {
        status: string;
        data: { would: string };
        next_commands: string[];
      };
      expect(json.status).toBe("skipped");
      expect(json.data.would).toBe("Create a link to claim this project.");
      expect(json.next_commands).toEqual([expect.stringContaining("claim --no-wait")]);
    });
  });

  describe("--challenge-id", () => {
    async function handOutLink(cwd: string): Promise<string> {
      const res = await claim(cwd, ["--no-wait"]);
      return (parseJson(res.stdout) as { data: { challenge_id: string } }).data.challenge_id;
    }

    it("waits on a handed-out link and records the claim", async () => {
      const { cwd, project } = await makeProject();
      const challengeId = await handOutLink(cwd);
      completeClaimChallenge(challengeId, project.id);

      const res = await claim(cwd, ["--challenge-id", challengeId]);

      expect(res.exitCode).toBe(0);
      const json = parseJson(res.stdout) as {
        status: string;
        data: { title: string; team_id: string; claimed_at: string };
      };
      expect(json.status).toBe("ok");
      expect(json.data.title).toBe("Your Project is now permanent.");
      const secret = await readSecret(cwd);
      expect(secret.team_id).toBe(json.data.team_id);
      expect(secret.claimed_at).toBe(json.data.claimed_at);
    });

    it("mints no second link", async () => {
      const { cwd, project } = await makeProject();
      const challengeId = await handOutLink(cwd);
      completeClaimChallenge(challengeId, project.id);

      await claim(cwd, ["--challenge-id", challengeId]);

      expect(snapshotPlatformStore().claimChallengeIds).toEqual([challengeId]);
    });

    it("suggests a new link that does not wait when the handed-out one expires", async () => {
      const { cwd } = await makeProject();
      const challengeId = await handOutLink(cwd);
      expireClaimChallenge(challengeId);

      const res = await claim(cwd, ["--challenge-id", challengeId]);

      expect(res.exitCode).toBe(3);
      const json = parseJson(res.stdout) as { code: string; next_commands: string[] };
      expect(json.code).toBe("E_VALIDATION");
      expect(json.next_commands).toEqual([expect.stringContaining("claim --no-wait")]);
    });

    it("reports a link the platform never minted for this project as not found", async () => {
      const { cwd } = await makeProject();

      const res = await claim(cwd, ["--challenge-id", "ch_neverminted"]);

      expect(res.exitCode).toBe(4);
      const json = parseJson(res.stdout) as {
        code: string;
        message: string;
        next_commands: string[];
      };
      expect(json.code).toBe("E_NOT_FOUND");
      expect(json.message).toBe("This project has no claim link with that challenge id.");
      expect(json.next_commands).toEqual([expect.stringContaining("claim --no-wait")]);
    });

    it("refuses an id that is not a challenge id before connecting", async () => {
      const cwd = await mkdtemp(join(tmpdir(), "zitadel-claim-"));
      tempDirs.push(cwd);

      // No project is set up here, so reaching the server would fail on the
      // missing project id instead: the refusal has to come first.
      const res = await claim(cwd, ["--challenge-id", "ch_x;whoami"]);

      expect(res.exitCode).toBe(3);
      const json = parseJson(res.stdout) as { code: string; message: string };
      expect(json.code).toBe("E_VALIDATION");
      expect(json.message).toContain("--challenge-id");
    });
  });

  describe("--server local", () => {
    // These talk to a real socket on an ephemeral port. msw's platform
    // handlers match any origin, so they would otherwise swallow the stub's
    // claim routes and `onUnhandledRequest: "error"` would reject `/readyz`.
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
 * A minimal stand-in for a local Zitadel server: enough of `/readyz` for
 * `resolveLocalServer` to accept it, and a claim pair that completes on the
 * first poll. msw is bypassed here because the request goes to localhost with
 * a port only known at runtime; a real socket is simpler than reshaping the
 * handlers.
 */
async function startClaimServer(claimUrl = "http://localhost/claim/ch_localstub"): Promise<string> {
  const httpServer = createServer((req, res) => {
    const url = req.url ?? "";
    if (url === "/readyz") {
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

/** A runtime record of a server that is running: this process, answering at `serverUrl`. */
function runtimeFor(cwd: string, serverUrl: string): RuntimeMetadata {
  return aBinaryRecord({
    pid: process.pid,
    command: process.execPath,
    log_path: localRuntimePaths(cwd).logFile,
    port: Number(new URL(serverUrl).port),
    server_url: serverUrl,
    data_dir: localRuntimePaths(cwd).dataDir,
  });
}
