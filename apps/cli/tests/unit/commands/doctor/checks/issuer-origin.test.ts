import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, vi } from "vitest";

import { IssuerOriginCheck } from "@/commands/doctor/checks";
import { createZitadelClient } from "@/lib/backend";
import { takeReportedWarnings } from "@/lib/warnings";
import { aCheckContext, declined, forced } from "@tests/helpers/check-context";
import { it } from "@tests/helpers/fixtures";
import { write } from "@tests/helpers/git-repo";
import { usePlatformServer } from "@tests/helpers/platform-project";
import { asEnvironmentSelector, projectCommand, unscopedCommand } from "@/lib/suggestion";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * The server the projects live on.
 */
const SERVER = "https://api.zitadel.example";

/**
 * The issuer the app's environment names.
 */
const ISSUER = "http://localhost:3000";

/**
 * Where the mock serves one project.
 */
const PROJECT_ROUTE = `${SERVER}/api/v1/projects/:project_id`;

/**
 * The issuer held as a preview origin, as `zitadel setup` 0.1.0 left it.
 */
const AS_PREVIEW = [{ pattern: ISSUER, kind: "preview" as const }];

/**
 * The issuer held as a primary origin.
 */
const AS_PRIMARY = [{ pattern: ISSUER, kind: "primary" as const }];

const { server } = usePlatformServer();

/**
 * An origin of a project.
 */
type Origin = { pattern: string; kind: "primary" | "preview" };

/**
 * A project on the mock, and the directory bound to it.
 */
type Project = { id: string; secret: string; cwd: string };

/**
 * Creates a project holding `origins` on the mock, and fills `cwd` with the
 * files setup writes for it: `zitadel.json`, `.env.local` with the issuer, and
 * a `.zitadel/secret` recording `recorded`.
 *
 * @param cwd - The directory to bind to the project.
 * @param origins - The origins the server holds.
 * @param recorded - The origins the secret records; the server's unless given.
 * @returns The project.
 */
async function aProject(
  cwd: string,
  origins: Origin[],
  recorded: Origin[] = origins,
): Promise<Project> {
  const client = createZitadelClient({
    signal: new AbortController().signal,
    baseUrl: SERVER,
    token: undefined,
  });
  const created = await client.createProject({ name: "demo", origins });
  await write(cwd, {
    "zitadel.json": JSON.stringify({
      project: created.id,
      server: SERVER,
      framework: { id: "next" },
    }),
    ".env.local": `ZITADEL_ISSUER=${ISSUER}\n`,
    ".zitadel/secret": JSON.stringify({
      project_id: created.id,
      project_secret: created.project_secret,
      preview_secret: "sk_preview",
      primary_origins: patternsOf(recorded, "primary"),
      preview_origins: patternsOf(recorded, "preview"),
      created_at: "2026-10-01T00:00:00.000Z",
    }),
  });
  return { id: created.id, secret: created.project_secret, cwd };
}

/**
 * The patterns of the origins of one kind.
 *
 * @param origins - The origins.
 * @param kind - The kind to take.
 * @returns Their patterns.
 */
function patternsOf(origins: readonly Origin[], kind: Origin["kind"]): string[] {
  return origins
    .filter((origin) => {
      return origin.kind === kind;
    })
    .map((origin) => {
      return origin.pattern;
    });
}

/**
 * The origins the server holds for the project.
 *
 * @param project - The project.
 * @returns Its origins.
 */
async function serverOrigins(project: Project) {
  const client = createZitadelClient({
    signal: new AbortController().signal,
    baseUrl: SERVER,
    token: project.secret,
  });
  return (await client.getProject(project.id)).origins;
}

/**
 * What the project's `.zitadel/secret` records.
 *
 * @param project - The project.
 * @returns The parsed secret.
 */
async function recordedSecret(project: Project): Promise<unknown> {
  return JSON.parse(await readFile(join(project.cwd, ".zitadel/secret"), "utf8"));
}

/**
 * Makes the server fail every request that adds an origin as primary; any
 * other request passes on to the mock.
 */
function refusePrimaryAdds(): void {
  server.use(
    http.post(`${SERVER}/api/v1/projects/:project_id/origins`, async ({ request }) => {
      const body: unknown = await request.clone().json();
      if (typeof body === "object" && body !== null && "kind" in body && body.kind === "primary") {
        return HttpResponse.json({ code: "unavailable", message: "try again" }, { status: 503 });
      }
      return undefined;
    }),
  );
}

/**
 * Makes the project's own route answer `answer`.
 *
 * @param answer - How the server answers.
 */
function projectAnswers(answer: () => Response): void {
  server.use(http.get(PROJECT_ROUTE, answer));
}

beforeEach(() => {
  takeReportedWarnings();
});

describe("IssuerOriginCheck.run", () => {
  const check = new IssuerOriginCheck();

  describe("when the project holds its issuer as a preview origin and none as primary", () => {
    it("warns, naming the issuer and the server", async ({ dir }) => {
      await aProject(dir, AS_PREVIEW);

      const outcome = await check.run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        name: "issuer-origin",
        status: "warn",
        details: { pattern: ISSUER, server: SERVER },
      });
    });

    it("names the doctor --fix a reader can run", async ({ dir }) => {
      await aProject(dir, AS_PREVIEW);

      const outcome = await check.run(aCheckContext(dir));

      expect(outcome.message).toContain(unscopedCommand("doctor --fix", "0.1.0-alpha.0"));
    });

    it("carries the run's environment selection into the doctor --fix it names", async ({
      dir,
    }) => {
      await aProject(dir, AS_PREVIEW);
      const selector = asEnvironmentSelector(" --env staging");

      const outcome = await check.run(aCheckContext(dir, { selector }));

      expect(outcome.message).toContain(projectCommand("doctor --fix", selector, "0.1.0-alpha.0"));
    });

    it("matches an issuer written with a trailing slash", async ({ dir }) => {
      await aProject(dir, AS_PREVIEW);
      await write(dir, { ".env.local": `ZITADEL_ISSUER=${ISSUER}/\n` });

      const outcome = await check.run(aCheckContext(dir));

      expect(outcome.status).toBe("warn");
    });
  });

  it("asks no server when .zitadel/secret records the issuer as primary", async ({ dir }) => {
    await aProject(dir, AS_PRIMARY);
    projectAnswers(() => {
      return HttpResponse.error();
    });

    const outcome = await check.run(aCheckContext(dir));

    expect(outcome).toMatchObject({
      status: "pass",
      message: `${ISSUER} is not recorded as a preview origin`,
    });
  });

  it("passes a project made primary by hand that .zitadel/secret still records as preview", async ({
    dir,
  }) => {
    await aProject(dir, AS_PRIMARY, AS_PREVIEW);

    const outcome = await check.run(aCheckContext(dir));

    expect(outcome).toMatchObject({
      status: "pass",
      message: "The project has a primary origin to deploy to",
    });
  });

  describe("when it cannot tell", () => {
    it.for([
      [
        "the server cannot be reached",
        () => {
          return HttpResponse.error();
        },
      ],
      [
        "the server answers with JSON null",
        () => {
          return HttpResponse.json(null);
        },
      ],
    ] as const)("skips, passing, when %s", async ([, answer], { dir }) => {
      await aProject(dir, AS_PREVIEW);
      projectAnswers(answer);

      const outcome = await check.run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "pass",
        message: expect.stringContaining("Skipped: could not read the project's origins"),
      });
    });

    it("skips, passing, when no file sets ZITADEL_ISSUER", async ({ dir }) => {
      await aProject(dir, AS_PREVIEW);
      await rm(join(dir, ".env.local"));

      const outcome = await check.run(aCheckContext(dir));

      expect(outcome).toMatchObject({
        status: "pass",
        message: "Skipped: no file sets ZITADEL_ISSUER",
      });
    });

    it("skips, passing, when .zitadel/secret cannot be read", async ({ dir }) => {
      await aProject(dir, AS_PREVIEW);
      await rm(join(dir, ".zitadel/secret"));

      const outcome = await check.run(aCheckContext(dir));

      expect(outcome.status).toBe("pass");
    });
  });
});

describe("IssuerOriginCheck.fix", () => {
  const check = new IssuerOriginCheck();

  describe("with consent", () => {
    it("makes the issuer a primary origin on the server", async ({ dir }) => {
      const project = await aProject(dir, AS_PREVIEW);

      await check.fix(aCheckContext(dir, { consent: forced() }));

      expect(await serverOrigins(project)).toEqual(AS_PRIMARY);
    });

    it("records the issuer as primary in .zitadel/secret", async ({ dir }) => {
      const project = await aProject(dir, AS_PREVIEW);

      await check.fix(aCheckContext(dir, { consent: forced() }));

      expect(await recordedSecret(project)).toMatchObject({
        primary_origins: [ISSUER],
        preview_origins: [],
      });
    });

    it("leaves the check passing", async ({ dir }) => {
      await aProject(dir, AS_PREVIEW);

      await check.fix(aCheckContext(dir, { consent: forced() }));

      expect((await check.run(aCheckContext(dir))).status).toBe("pass");
    });

    it("says to deploy, as nothing is deployed to the origin it made primary", async ({ dir }) => {
      await aProject(dir, AS_PREVIEW);

      await check.fix(aCheckContext(dir, { consent: forced() }));

      expect(takeReportedWarnings()).toEqual([
        `${ISSUER} is a primary origin now, but it serves nothing until a deployment names it: deploy in the app.`,
      ]);
    });
  });

  describe("when the replacement is declined", () => {
    it("asks to replace the preview origin, naming the project and the server", async ({ dir }) => {
      const project = await aProject(dir, AS_PREVIEW);
      const consent = vi.fn(declined);

      await check.fix(aCheckContext(dir, { consent }));

      expect(consent).toHaveBeenCalledWith(
        expect.objectContaining({
          message: `Replace the preview origin ${ISSUER} with a primary one in project ${project.id} on api.zitadel.example?`,
        }),
      );
    });

    it("changes nothing", async ({ dir }) => {
      const project = await aProject(dir, AS_PREVIEW);

      await check.fix(aCheckContext(dir, { consent: declined }));

      expect(await serverOrigins(project)).toEqual(AS_PREVIEW);
    });
  });

  describe("with a dry run", () => {
    it("changes nothing", async ({ dir }) => {
      const project = await aProject(dir, AS_PREVIEW);

      await check.fix(aCheckContext(dir, { dryRun: true, consent: forced(true) }));

      expect(await serverOrigins(project)).toEqual(AS_PREVIEW);
    });
  });

  describe("when the server refuses the issuer as primary", () => {
    it("fails the repair", async ({ dir }) => {
      await aProject(dir, AS_PREVIEW);
      refusePrimaryAdds();

      const error = await rejectionOf(() => {
        return check.fix(aCheckContext(dir, { consent: forced() }));
      });

      expect(error).toBeInstanceOf(Error);
    });

    it("puts the preview origin back", async ({ dir }) => {
      const project = await aProject(dir, AS_PREVIEW);
      refusePrimaryAdds();

      await rejectionOf(() => {
        return check.fix(aCheckContext(dir, { consent: forced() }));
      });

      expect(await serverOrigins(project)).toEqual(AS_PREVIEW);
    });

    it("leaves .zitadel/secret alone", async ({ dir }) => {
      const project = await aProject(dir, AS_PREVIEW);
      refusePrimaryAdds();

      await rejectionOf(() => {
        return check.fix(aCheckContext(dir, { consent: forced() }));
      });

      expect(await recordedSecret(project)).toMatchObject({
        primary_origins: [],
        preview_origins: [ISSUER],
      });
    });
  });
});
