import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { HttpResponse, http } from "msw";
import type { SetupServer } from "msw/node";
import { afterEach, describe, expect } from "vitest";

import ApplicationCreate from "@/cli/commands/application/create";
import { it } from "@tests/fixtures";
import { parseFlag } from "@tests/helpers/inputs";
import { answering } from "@tests/helpers/keyboard";
import { aProjectDirectory } from "@tests/helpers/platform-project";
import { parseJson, runCliForTest, runCommand } from "@tests/helpers/run-cli";
import { asTerminal } from "@tests/fixtures/terminal";
import { rejectionOf } from "@tests/helpers/thrown-value";

/** The server the command is pointed at, which the test's msw server answers. */
const SERVER = "https://api.zitadel.example";

/** The application id a create answers with. */
const APP_ID = "app_01JCQK5R7T9V1X3Z5B7D9F1H3J";

/** The client id a create answers with. */
const CLIENT_ID = "cli_01JCQK5R7T9V1X3Z5B7D9F1H3K";

/** The one-shot secret a create answers with. */
const SECRET = "sec_once_only";

/** The create requests the server received. */
const posted: unknown[] = [];

/** Answers every create and records the body. */
function answeringCreates(server: SetupServer): void {
  posted.length = 0;
  server.use(
    http.post(`${SERVER}/api/v1/applications`, async ({ request }) => {
      posted.push(await request.json());
      return HttpResponse.json(
        {
          id: APP_ID,
          revision_id: "rev_1",
          slug: "acme-dashboard",
          declared: false,
          created_at: "2026-11-10T10:00:00Z",
          updated_at: "2026-11-10T10:00:00Z",
          definition: {
            slug: "acme-dashboard",
            name: "Acme Dashboard",
            clients: [
              {
                slug: "web",
                type: "confidential",
                grant_types: ["authorization_code"],
                redirect_uris: ["http://localhost:3000/auth/callback"],
                client_id: CLIENT_ID,
                first_party: false,
              },
            ],
          },
          client_secrets: [{ client: "web", client_id: CLIENT_ID, secret: SECRET }],
        },
        { status: 201 },
      );
    }),
  );
}

/** A project directory with ZITADEL_ISSUER set for the paste block. */
async function anApp(dirs: string[]): Promise<string> {
  const cwd = await aProjectDirectory("zitadel-application-create-", {
    id: "proj_unit",
    secret: "sk_unit",
  });
  await writeFile(join(cwd, ".env.local"), "ZITADEL_ISSUER=http://localhost:3000\n");
  dirs.push(cwd);
  return cwd;
}

/** Runs a create that asks nothing, with `extra` flags. */
function create(cwd: string, ...extra: string[]): Promise<unknown> {
  return runCommand(ApplicationCreate, "application:create", [
    "--name",
    "Acme Dashboard",
    "--preset",
    "web",
    "--redirect-uri",
    "http://localhost:3000/auth/callback",
    ...extra,
    "--json",
    "--cwd",
    cwd,
    "--server",
    SERVER,
  ]);
}

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("application create flags", () => {
  it("takes a name, trimmed", async () => {
    await expect(
      parseFlag(ApplicationCreate.flags.name, "  Acme Dashboard ", "name"),
    ).resolves.toBe("Acme Dashboard");
  });

  it("refuses a blank name", async () => {
    await expect(parseFlag(ApplicationCreate.flags.name, "   ", "name")).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });

  it("takes a redirect URI", async () => {
    await expect(
      parseFlag(
        ApplicationCreate.flags["redirect-uri"],
        "http://localhost:3000/auth/callback",
        "redirect-uri",
      ),
    ).resolves.toBe("http://localhost:3000/auth/callback");
  });

  it("takes an origin", async () => {
    await expect(
      parseFlag(ApplicationCreate.flags.origin, "http://localhost:5173", "origin"),
    ).resolves.toBe("http://localhost:5173");
  });
});

describe("application create --non-interactive", () => {
  it("creates a web application and returns credentials in --json", async ({ server }) => {
    answeringCreates(server);
    const cwd = await anApp(dirs);

    const result = await runCliForTest([
      "application",
      "create",
      "--name",
      "Acme Dashboard",
      "--preset",
      "web",
      "--redirect-uri",
      "http://localhost:3000/auth/callback",
      "--json",
      "--cwd",
      cwd,
      "--server",
      SERVER,
    ]);

    expect(parseJson(result.stdout)).toMatchObject({
      status: "ok",
      data: {
        application: { id: APP_ID, name: "Acme Dashboard", slug: "acme-dashboard" },
        client: {
          id: CLIENT_ID,
          slug: "web",
          preset: "web",
          type: "confidential",
          secret: SECRET,
        },
        issuer: "http://localhost:3000/__nextgen/oauth/proj_unit",
        redirect_uris: ["http://localhost:3000/auth/callback"],
        allowed_origins: null,
        env: {
          ZITADEL_ISSUER: "http://localhost:3000/__nextgen/oauth/proj_unit",
          ZITADEL_CLIENT_ID: CLIENT_ID,
          ZITADEL_CLIENT_SECRET: SECRET,
          ZITADEL_CALLBACK_URL: "http://localhost:3000/auth/callback",
        },
        wrote_env_file: null,
      },
    });
    expect(posted).toEqual([
      {
        application: {
          slug: "acme-dashboard",
          name: "Acme Dashboard",
          clients: [
            {
              slug: "web",
              type: "confidential",
              grant_types: ["authorization_code"],
              redirect_uris: ["http://localhost:3000/auth/callback"],
            },
          ],
        },
      },
    ]);
  });

  it("lists every missing required flag at once", async () => {
    const cwd = await anApp(dirs);

    const result = await runCliForTest([
      "application",
      "create",
      "--non-interactive",
      "--json",
      "--cwd",
      cwd,
      "--server",
      SERVER,
    ]);

    expect(parseJson(result.stdout)).toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("--name"),
    });
  });

  it("refuses spa until public clients ship", async ({ server }) => {
    answeringCreates(server);
    const cwd = await anApp(dirs);

    const result = await runCliForTest([
      "application",
      "create",
      "--name",
      "Acme SPA",
      "--preset",
      "spa",
      "--redirect-uri",
      "http://localhost:5173/callback",
      "--origin",
      "http://localhost:5173",
      "--json",
      "--cwd",
      cwd,
      "--server",
      SERVER,
    ]);

    expect(parseJson(result.stdout)).toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("public clients"),
    });
    expect(posted).toEqual([]);
  });

  it("refuses --origin with --preset web", async ({ server }) => {
    answeringCreates(server);
    const cwd = await anApp(dirs);

    const result = await runCliForTest([
      "application",
      "create",
      "--name",
      "Acme",
      "--preset",
      "web",
      "--redirect-uri",
      "http://localhost:3000/callback",
      "--origin",
      "http://localhost:3000",
      "--json",
      "--cwd",
      cwd,
      "--server",
      SERVER,
    ]);

    expect(parseJson(result.stdout)).toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("--origin only applies"),
    });
  });

  it("writes credentials when --application-env-file is set", async ({ server }) => {
    answeringCreates(server);
    const cwd = await anApp(dirs);
    const envPath = ".env.application";

    const result = await runCliForTest([
      "application",
      "create",
      "--name",
      "Acme Dashboard",
      "--preset",
      "web",
      "--redirect-uri",
      "http://localhost:3000/auth/callback",
      "--application-env-file",
      envPath,
      "--json",
      "--cwd",
      cwd,
      "--server",
      SERVER,
    ]);

    expect(parseJson(result.stdout)).toMatchObject({
      status: "ok",
      data: { wrote_env_file: envPath },
    });
    const written = await readFile(join(cwd, envPath), "utf8");
    expect(written).toContain(`ZITADEL_CLIENT_ID=${CLIENT_ID}`);
    expect(written).toContain(`ZITADEL_CLIENT_SECRET=${SECRET}`);
  });

  it("creates nothing on --dry-run", async ({ server }) => {
    answeringCreates(server);
    const cwd = await anApp(dirs);

    await create(cwd, "--dry-run");

    expect(posted).toEqual([]);
  });
});

describe("application create, run by a person", () => {
  it("asks name, preset, redirect, then whether to write env", async ({ server }) => {
    answeringCreates(server);
    const cwd = await anApp(dirs);
    const talk = answering(
      "Acme Dashboard",
      "Website with a backend",
      "http://localhost:3000/auth/callback",
      false,
      false,
    );

    await asTerminal(() => {
      return runCommand(ApplicationCreate, "application:create", [
        "--cwd",
        cwd,
        "--server",
        SERVER,
      ]);
    });

    expect(talk.asked()).toEqual([
      "What's your product called?",
      "What are you connecting first?",
      "Sign-in callback URL",
      "Add another redirect URI?",
      "Write credentials to a .env file?",
    ]);
    expect(posted).toHaveLength(1);
  });

  it("maps Help me choose (browser + secret) to web", async ({ server }) => {
    answeringCreates(server);
    const cwd = await anApp(dirs);
    const talk = answering(
      "Acme Dashboard",
      "Help me choose",
      "Browser",
      "Yes",
      "http://localhost:3000/auth/callback",
      false,
      false,
    );

    await asTerminal(() => {
      return runCommand(ApplicationCreate, "application:create", ["--cwd", cwd, "--server", SERVER]);
    });

    expect(talk.asked()).toEqual([
      "What's your product called?",
      "What are you connecting first?",
      "Does sign-in run in a browser, or as an installed app?",
      "Does your server keep a client secret?",
      "Sign-in callback URL",
      "Add another redirect URI?",
      "Write credentials to a .env file?",
    ]);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      application: { clients: [{ slug: "web", type: "confidential" }] },
    });
  });

  it("maps Help me choose (browser, no secret) to spa and refuses", async ({ server }) => {
    answeringCreates(server);
    const cwd = await anApp(dirs);
    answering(
      "Acme SPA",
      "Help me choose",
      "Browser",
      "No",
      "http://localhost:5173/callback",
      false,
      "http://localhost:5173",
      false,
    );

    const refused = await rejectionOf(() => {
      return asTerminal(() => {
        return runCommand(ApplicationCreate, "application:create", [
          "--cwd",
          cwd,
          "--server",
          SERVER,
        ]);
      });
    });

    expect(refused).toMatchObject({ oclif: { exit: 3 } });
    expect(posted).toEqual([]);
  });

  it("refuses spa after the kind is chosen", async ({ server }) => {
    answeringCreates(server);
    const cwd = await anApp(dirs);
    answering(
      "Acme SPA",
      "Browser-only app",
      "http://localhost:5173/callback",
      false,
      "http://localhost:5173",
      false,
    );

    const refused = await rejectionOf(() => {
      return asTerminal(() => {
        return runCommand(ApplicationCreate, "application:create", [
          "--cwd",
          cwd,
          "--server",
          SERVER,
        ]);
      });
    });

    expect(refused).toMatchObject({ oclif: { exit: 3 } });
    expect(posted).toEqual([]);
  });
});
