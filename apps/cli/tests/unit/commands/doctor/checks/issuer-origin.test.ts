import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { IssuerOriginCheck, type CheckContext } from "../../../../../src/commands/doctor/checks";
import { createZitadelClient } from "../../../../../src/lib/api-client";
import { createOrca } from "../../../../../src/lib/orca";
import { usePlatformServer } from "../../../../helpers/platform-project";

const SERVER = "https://api.zitadel.example";
const ISSUER = "http://localhost:3000";
const { server, dirs: tempDirs } = usePlatformServer();

type Origin = { pattern: string; kind: "primary" | "preview" };
type Project = { id: string; project_secret: string; cwd: string };

/**
 * A project on the mock holding `origins`, with the files setup writes for it:
 * `zitadel.json`, `.env.local` with the issuer, and a `.zitadel/secret` that
 * records `recorded` (the server's origins unless given).
 */
async function aProject(origins: Origin[], recorded: Origin[] = origins): Promise<Project> {
  const response = await fetch(`${SERVER}/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "demo", origins }),
  });
  const project = (await response.json()) as { id: string; project_secret: string };
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-issuer-origin-"));
  tempDirs.push(cwd);
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeFile(
    join(cwd, "zitadel.json"),
    JSON.stringify({ project: project.id, server: SERVER, framework: { id: "next" } }),
  );
  await writeFile(join(cwd, ".env.local"), `ZITADEL_ISSUER=${ISSUER}\n`);
  await writeFile(
    join(cwd, ".zitadel/secret"),
    JSON.stringify({
      project_id: project.id,
      project_secret: project.project_secret,
      preview_secret: "sk_preview",
      primary_origins: recorded.filter((o) => o.kind === "primary").map((o) => o.pattern),
      preview_origins: recorded.filter((o) => o.kind === "preview").map((o) => o.pattern),
      created_at: "2026-10-01T00:00:00.000Z",
    }),
  );
  return { ...project, cwd };
}

/** A project as `zitadel setup` 0.1.0 left it: its issuer a preview origin, nothing primary. */
function aProjectFrom010(): Promise<Project> {
  return aProject([{ pattern: ISSUER, kind: "preview" }]);
}

function ctxFor(cwd: string, dryRun = false): CheckContext {
  return { cwd, orca: createOrca(), cliVersion: "0.2.0", dryRun };
}

async function serverOrigins(project: Project) {
  const client = createZitadelClient({ baseUrl: SERVER, token: project.project_secret });
  return (await client.getProject(project.id)).origins;
}

async function recordedSecret(project: Project) {
  return JSON.parse(await readFile(join(project.cwd, ".zitadel/secret"), "utf8")) as {
    primary_origins: string[];
    preview_origins: string[];
  };
}

/** Fails every request that would add `pattern` as primary; any other passes on to the mock. */
function refusePrimaryAdds(): void {
  server.use(
    http.post(`${SERVER}/projects/:project_id/origins`, async ({ request }) => {
      const body = (await request.clone().json()) as { kind?: string };
      if (body.kind === "primary") {
        return HttpResponse.json({ code: "unavailable", message: "try again" }, { status: 503 });
      }
      return undefined;
    }),
  );
}

describe("IssuerOriginCheck", () => {
  const check = new IssuerOriginCheck();

  it("warns when the project holds its issuer as a preview origin and none as primary", async () => {
    const project = await aProjectFrom010();

    const outcome = await check.run(ctxFor(project.cwd));

    expect(outcome).toMatchObject({
      name: "issuer-origin",
      status: "warn",
      details: { pattern: ISSUER, server: SERVER },
    });
  });

  it("names doctor --fix in the warning", async () => {
    const project = await aProjectFrom010();

    const outcome = await check.run(ctxFor(project.cwd));

    expect(outcome.message).toContain("zitadel doctor --fix");
  });

  it("asks no server when .zitadel/secret records the issuer as primary", async () => {
    const project = await aProject([{ pattern: ISSUER, kind: "primary" }]);
    server.use(http.get(`${SERVER}/projects/:project_id`, () => HttpResponse.error()));

    const outcome = await check.run(ctxFor(project.cwd));

    expect(outcome).toMatchObject({
      status: "pass",
      message: `${ISSUER} is not recorded as a preview origin`,
    });
  });

  it("passes a project made primary by hand that .zitadel/secret still records as preview", async () => {
    const project = await aProject(
      [{ pattern: ISSUER, kind: "primary" }],
      [{ pattern: ISSUER, kind: "preview" }],
    );

    const outcome = await check.run(ctxFor(project.cwd));

    expect(outcome).toMatchObject({
      status: "pass",
      message: "The project has a primary origin to deploy to",
    });
  });

  it("matches an issuer written with a trailing slash", async () => {
    const project = await aProjectFrom010();
    await writeFile(join(project.cwd, ".env.local"), `ZITADEL_ISSUER=${ISSUER}/\n`);

    const outcome = await check.run(ctxFor(project.cwd));

    expect(outcome.status).toBe("warn");
  });

  it("skips, passing, when the server cannot be reached", async () => {
    const project = await aProjectFrom010();
    server.use(http.get(`${SERVER}/projects/:project_id`, () => HttpResponse.error()));

    const outcome = await check.run(ctxFor(project.cwd));

    expect(outcome).toMatchObject({
      status: "pass",
      message: expect.stringContaining("Skipped: could not read the project's origins"),
    });
  });

  it("skips, passing, when no file sets ZITADEL_ISSUER", async () => {
    const project = await aProjectFrom010();
    await rm(join(project.cwd, ".env.local"));

    const outcome = await check.run(ctxFor(project.cwd));

    expect(outcome).toMatchObject({
      status: "pass",
      message: "Skipped: no file sets ZITADEL_ISSUER",
    });
  });

  it("skips, passing, when .zitadel/secret cannot be read", async () => {
    const project = await aProjectFrom010();
    await rm(join(project.cwd, ".zitadel/secret"));

    const outcome = await check.run(ctxFor(project.cwd));

    expect(outcome.status).toBe("pass");
  });

  describe("fix", () => {
    it("makes the issuer a primary origin on the server", async () => {
      const project = await aProjectFrom010();

      await check.fix(ctxFor(project.cwd));

      expect(await serverOrigins(project)).toEqual([{ pattern: ISSUER, kind: "primary" }]);
    });

    it("records the issuer as primary in .zitadel/secret", async () => {
      const project = await aProjectFrom010();

      await check.fix(ctxFor(project.cwd));

      expect(await recordedSecret(project)).toMatchObject({
        primary_origins: [ISSUER],
        preview_origins: [],
      });
    });

    it("leaves the check passing", async () => {
      const project = await aProjectFrom010();

      await check.fix(ctxFor(project.cwd));

      expect((await check.run(ctxFor(project.cwd))).status).toBe("pass");
    });

    it("changes nothing under dryRun", async () => {
      const project = await aProjectFrom010();

      await check.fix(ctxFor(project.cwd, true));

      expect(await serverOrigins(project)).toEqual([{ pattern: ISSUER, kind: "preview" }]);
    });

    it("puts the preview origin back when the server refuses it as primary", async () => {
      const project = await aProjectFrom010();
      refusePrimaryAdds();

      await expect(check.fix(ctxFor(project.cwd))).rejects.toThrow();

      expect(await serverOrigins(project)).toEqual([{ pattern: ISSUER, kind: "preview" }]);
    });

    it("leaves .zitadel/secret alone when the server refuses it as primary", async () => {
      const project = await aProjectFrom010();
      refusePrimaryAdds();

      await check.fix(ctxFor(project.cwd)).catch(() => undefined);

      expect(await recordedSecret(project)).toMatchObject({
        primary_origins: [],
        preview_origins: [ISSUER],
      });
    });
  });
});
