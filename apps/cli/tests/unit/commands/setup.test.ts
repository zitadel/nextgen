import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { DEFAULT_SETUP_PRESET, DEFAULT_SETUP_USE_CASE } from "@zitadel/config/defaults";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, vi } from "vitest";

vi.mock("@clack/prompts", async () => {
  return (await import("@tests/helpers/clack")).clackDouble();
});

vi.mock("@/commands/setup/prompts", async (importOriginal) => {
  return { ...(await importOriginal<object>()), askCustomSettings: vi.fn() };
});

import { confirm, intro, isCancel, multiselect, select } from "@clack/prompts";

import Setup, {
  localServerHostsPlatform,
  portInUseWarning,
  retryOptionsFromFlags,
  setupRetryFlags,
  ssoFromFlags,
} from "@/commands/setup";
import { moveDevPort } from "@/commands/setup/move-dev-port";
import { askCustomSettings } from "@/commands/setup/prompts";
import { createZitadelClient } from "@/lib/backend";
import { ZitadelError } from "@/lib/errors";
import { customExample, SETUP_FLAG_NAMES } from "@/lib/idp";
import { type Asker, input } from "@/lib/input";
import { writeRuntimeMetadata } from "@/lib/local-server/runtime";
import { LocalServer } from "@/lib/local-server/server";
import { createOrca } from "@/lib/orca";
import { readZitadelSecret } from "@/lib/project";
import { unscopedCommand } from "@/lib/suggestion";
import { aFakeAppGeneratorPath } from "@tests/helpers/app-generator";
import { it, type Serve } from "@tests/helpers/fixtures";
import { write } from "@tests/helpers/git-repo";
import { usePlatformServer } from "@tests/helpers/platform-project";
import { expectedPublicCliCommand, parseJson, runCliForTest } from "@tests/helpers/run-cli";
import { aDockerRecord } from "@tests/helpers/runtime-record";
import { aNextApp, suggestedCommands } from "@tests/helpers/setup";
import { asTerminal } from "@tests/helpers/terminal";
import { rejectionOf } from "@tests/helpers/thrown-value";

const { server } = usePlatformServer();

/**
 * The cloud platform the mock answers for.
 */
const CLOUD = "https://api.zitadel.cloud";

/**
 * A local server the mock answers for, as `zitadel start` would run one.
 */
const LOCAL_SERVER = "http://localhost:9941";

/**
 * A preview of setting up a Next.js app, which contacts no platform.
 */
const DRY_RUN_NEXT = ["--dry-run", "--framework", "next"];

/**
 * A scripted setup of a Next.js app, skipping the install.
 */
const SCRIPTED_NEXT = ["--non-interactive", "--skip-install", "--framework", "next"];

/**
 * `--dev-port` for a run that checks every warning: setup warns when the
 * app's detected port is taken, and whatever holds 3000 on the machine
 * running the tests must not decide what it reports.
 */
const PINNED_DEV_PORT = ["--dev-port", "3000"];

/**
 * A scripted move of an app already set up to port 3101.
 */
const MOVE_TO_3101 = ["--non-interactive", "--dev-port", "3101"];

/**
 * A Google client id of the shape Google issues.
 */
const GOOGLE_CLIENT_ID = "1234-abc.apps.googleusercontent.com";

/**
 * A custom provider described in full, short of its client id.
 */
const ACME = [
  "--sso",
  "custom",
  "--sso-slug",
  "acme-sso",
  "--sso-display-name",
  "Acme SSO",
  "--sso-issuer",
  "https://sso.acme.example",
];

/**
 * The claim nudge setup ends a new project's suggestions with.
 */
const CLAIM_COMMAND =
  /^npx @zitadel\/cli@\S+ claim --env-file \S+\/\.env\.development\.local --cwd \S+$/;

/**
 * The runtime document of a local server that hosts its own platform project
 * and claim page.
 */
const PLATFORM_RUNTIME = {
  mode: "standalone",
  console_project_id: "proj_platform",
  publishable_key: "pk_platform",
};

/**
 * What a prompt answers when the person cancels it; the clack double's
 * `isCancel` is told to know it.
 */
const CANCELLED = Symbol("cancelled");

/**
 * Asks as a person at a terminal would be asked.
 *
 * @param question - The question.
 * @returns The answer.
 */
const ask: Asker = (question) => {
  return input(question, { interactive: true, force: false });
};

/**
 * A Vite React app.
 */
const REACT_APP = {
  "package.json": JSON.stringify({
    name: "demo",
    dependencies: { react: "^19.0.0", vite: "^8.0.0" },
  }),
  "vite.config.ts": "export default {}\n",
  "src/.keep": "",
};

/**
 * An app of each framework setup supports, and the file setup writes into it.
 */
const FRAMEWORK_APPS: ReadonlyArray<{
  framework: string;
  expectedFile: string;
  files: Record<string, string>;
}> = [
  {
    framework: "next",
    expectedFile: "app/login/page.tsx",
    files: {
      "package.json": JSON.stringify({ name: "demo", dependencies: { next: "^15" } }),
      "app/layout.tsx": "export default function L() {}\n",
    },
  },
  {
    framework: "nuxt",
    expectedFile: "app/pages/login.vue",
    files: {
      "package.json": JSON.stringify({ name: "demo", dependencies: { nuxt: "^4.0.0" } }),
      "nuxt.config.ts": "export default defineNuxtConfig({})\n",
      "app/.keep": "",
    },
  },
  {
    framework: "react",
    expectedFile: "src/App.tsx",
    files: REACT_APP,
  },
  {
    framework: "vue",
    expectedFile: "src/App.vue",
    files: {
      "package.json": JSON.stringify({
        name: "demo",
        dependencies: { vue: "^3.0.0", vite: "^8.0.0" },
      }),
      "vite.config.ts": "export default {}\n",
      "src/.keep": "",
    },
  },
  {
    framework: "angular",
    expectedFile: "src/app/app.ts",
    files: {
      "package.json": JSON.stringify({
        name: "demo",
        dependencies: { "@angular/core": "^20.0.0" },
      }),
      "angular.json": JSON.stringify({
        defaultProject: "demo",
        projects: { demo: { architect: { serve: { options: {} } } } },
      }),
      "src/app/app.routes.ts":
        "import { Routes } from '@angular/router';\n\nexport const routes: Routes = [];\n",
    },
  },
];

/**
 * `setup` in `cwd` against the cloud, with one JSON envelope on stdout.
 *
 * @param cwd - The directory to set up.
 * @param flags - Further flags to pass.
 * @returns The command line.
 */
function onTheCloud(cwd: string, ...flags: string[]): string[] {
  return ["setup", "--cwd", cwd, "--json", "--server", CLOUD, ...flags];
}

/**
 * `setup` in `cwd` against `server`, with one JSON envelope on stdout.
 *
 * @param cwd - The directory to set up.
 * @param server - The server to set it up against.
 * @param flags - Further flags to pass.
 * @returns The command line.
 */
function against(cwd: string, server: string, ...flags: string[]): string[] {
  return ["setup", "--cwd", cwd, "--json", "--server", server, ...flags];
}

/**
 * The environment that ends the search for local state at `cwd`, which keeps
 * the developer's own `~/.zitadel/local` out of the test.
 *
 * @param cwd - The directory to treat as home.
 * @returns The environment to run with.
 */
function homeAt(cwd: string): NodeJS.ProcessEnv {
  return { HOME: cwd, USERPROFILE: cwd };
}

/**
 * Holds a port the system picks until the test ends.
 *
 * @param serve - The fixture that holds it.
 * @returns The port.
 */
async function aHeldPort(serve: Serve): Promise<number> {
  const url = await serve((_req, res) => {
    res.end();
  });
  return Number(new URL(url).port);
}

/**
 * Records in `cwd` what `zitadel start` records beside the local admin: which
 * server it started.
 *
 * @param cwd - The directory `start` ran in.
 * @param serverUrl - The server it started.
 * @returns Once the record is written.
 */
async function recordStartedServer(cwd: string, serverUrl: string): Promise<void> {
  await writeRuntimeMetadata(
    cwd,
    aDockerRecord({
      port: Number(new URL(serverUrl).port),
      server_url: serverUrl,
      data_dir: join(cwd, ".zitadel/local/nextgen-data"),
    }),
  );
}

/**
 * Writes the local admin `zitadel start` creates into `cwd`.
 *
 * @param cwd - The directory `start` ran in.
 * @returns Once the admin is written.
 */
async function aLocalAdmin(cwd: string): Promise<void> {
  await write(cwd, {
    ".zitadel/local/admin.json": JSON.stringify({
      email: "admin@zitadel.localhost",
      password: "local-admin-password",
      user_id: "user_localadmin",
      team_id: "team_localadmin",
    }),
  });
}

/**
 * An empty directory named as npm requires a package to be, which a new app's
 * must be.
 *
 * @param parent - The directory to make it in.
 * @returns Its path.
 */
async function aNewAppDirectory(parent: string): Promise<string> {
  const cwd = join(parent, "my-app");
  await mkdir(cwd);
  return cwd;
}

/**
 * Answers `server`'s runtime document as a local server hosting its own
 * platform project does.
 *
 * @param serverUrl - The server.
 * @returns The handler.
 */
function hostingThePlatform(serverUrl: string) {
  return http.get(`${serverUrl}/console/runtime.json`, () => {
    return HttpResponse.json(PLATFORM_RUNTIME);
  });
}

/**
 * Answers the local admin's sign-in and the claim it makes on `serverUrl`.
 * Completing the claim is a cookie-authenticated write, so it is refused
 * without the session's CSRF token, as the server does (ADR 053 §5).
 *
 * @param serverUrl - The local server.
 * @returns The handlers.
 */
function signingInTheAdmin(serverUrl: string) {
  return [
    http.post(`${serverUrl}/api/v1/auth_attempts`, () => {
      return HttpResponse.json({ attempt_id: "att_1" }, { status: 201 });
    }),
    http.post(`${serverUrl}/api/v1/auth_attempts/:attempt/challenges`, () => {
      return HttpResponse.json({ challenge_id: "ch_1" }, { status: 201 });
    }),
    http.post(`${serverUrl}/api/v1/auth_attempts/:attempt/challenges/:challenge/verify`, () => {
      return HttpResponse.json({ attempt_id: "att_1" });
    }),
    http.post(`${serverUrl}/api/v1/auth_attempts/:attempt/handoff`, () => {
      return HttpResponse.json({ handoff_token: "handoff_1" });
    }),
    http.post(`${serverUrl}/api/v1/sessions/exchange`, () => {
      return new HttpResponse(null, {
        headers: { "set-cookie": "zitadel_session=admin_session; Path=/; HttpOnly" },
      });
    }),
    http.post(`${serverUrl}/api/v1/projects/:projectId/claim/init`, () => {
      return HttpResponse.json({ challenge_id: "claim_ch_1" }, { status: 201 });
    }),
    http.get(`${serverUrl}/api/v1/sessions/me/csrf`, () => {
      return HttpResponse.json({ csrf_token: "csrf_admin" });
    }),
    http.post(`${serverUrl}/api/v1/projects/:projectId/claim/complete`, ({ request }) => {
      if (request.headers.get("x-zitadel-csrf") === "csrf_admin") {
        return HttpResponse.json({
          team_id: "team_localadmin",
          claimed_at: "2027-01-01T00:00:00Z",
        });
      }
      return HttpResponse.json({ code: "auth.csrf_invalid", message: "no" }, { status: 403 });
    }),
  ];
}

/**
 * Makes the platform refuse to create a project.
 *
 * @returns The handler.
 */
function refusingProjects() {
  return http.post("*/projects", () => {
    return HttpResponse.json({ code: "E_INTERNAL", message: "boom" }, { status: 500 });
  });
}

/**
 * Reads a JSON file of an app.
 *
 * @param cwd - The app's directory.
 * @param path - The file, from the app's directory.
 * @returns The parsed file.
 */
async function readJsonAt(cwd: string, path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(cwd, path), "utf8"));
}

/**
 * A client of the cloud, acting as the project `cwd` is bound to.
 *
 * @param cwd - The app's directory.
 * @returns The client and the project's id.
 */
async function aClientOf(cwd: string) {
  const secret = await readZitadelSecret(cwd);
  const client = createZitadelClient({
    signal: new AbortController().signal,
    baseUrl: CLOUD,
    token: secret.project_secret,
  });
  return { client, projectId: secret.project_id };
}

/**
 * The origins the platform holds for the project `cwd` is bound to.
 *
 * @param cwd - The app's directory.
 * @returns Its origins.
 */
async function projectOrigins(cwd: string) {
  const { client, projectId } = await aClientOf(cwd);
  return (await client.getProject(projectId)).origins;
}

/**
 * What the project `cwd` is bound to serves now, as `deployment list --live`
 * reads it.
 *
 * @param cwd - The app's directory.
 * @returns Its live deployments.
 */
async function liveDeployments(cwd: string) {
  const { client, projectId } = await aClientOf(cwd);
  return client.listDeployments.all({ project_id: projectId, live: true });
}

describe("setup", () => {
  describe("with zitadel.json already present", () => {
    it("reports itself skipped, as already initialized", async ({ dir }) => {
      await aNextApp(dir);
      await write(dir, { "zitadel.json": JSON.stringify({ project: "existing" }) });

      const res = await runCliForTest(onTheCloud(dir));

      expect(res).toBeSkipped();
      expect(parseJson(res.stdout)).toMatchObject({ reason: "already-initialized" });
    });
  });

  describe("with .zitadel/secret but no zitadel.json", () => {
    it("refuses with E_CONFLICT", async ({ dir }) => {
      await aNextApp(dir);
      await write(dir, { ".zitadel/secret": "{}" });

      const res = await runCliForTest(onTheCloud(dir));

      expect(res).toFailWith("E_CONFLICT");
    });
  });

  describe("as a dry run", () => {
    it("reports a stub project", async ({ dir }) => {
      await aNextApp(dir);

      const res = await runCliForTest(onTheCloud(dir, ...DRY_RUN_NEXT));

      expect(parseJson(res.stdout)).toMatchObject({
        status: "ok",
        data: { project: { project_id: "dry-run-0000" } },
      });
    });

    it.for(FRAMEWORK_APPS)("sets up a $framework app", async ({ framework, files }, { dir }) => {
      await write(dir, files);

      const res = await runCliForTest(
        onTheCloud(dir, "--dry-run", "--skip-install", "--framework", framework),
      );

      expect(parseJson(res.stdout)).toMatchObject({ status: "ok", data: { framework } });
    });

    it.for(FRAMEWORK_APPS)(
      "writes $expectedFile into a $framework app",
      async ({ framework, files, expectedFile }, { dir }) => {
        await write(dir, files);

        const res = await runCliForTest(
          onTheCloud(dir, "--dry-run", "--skip-install", "--framework", framework),
        );

        expect(parseJson(res.stdout)).toMatchObject({
          data: { files_written: expect.arrayContaining([expectedFile]) },
        });
      },
    );

    it.for(FRAMEWORK_APPS)(
      "skips the install of a $framework app as a dry run",
      async ({ framework, files }, { dir }) => {
        await write(dir, files);

        const res = await runCliForTest(
          onTheCloud(dir, "--dry-run", "--skip-install", "--framework", framework),
        );

        expect(parseJson(res.stdout)).toMatchObject({
          data: { install: { status: "skipped", reason: "dry-run", command: "npm install" } },
        });
      },
    );

    it.for(FRAMEWORK_APPS)(
      "suggests installing and running a $framework app first",
      async ({ framework, files }, { dir }) => {
        await write(dir, files);

        const res = await runCliForTest(
          onTheCloud(dir, "--dry-run", "--skip-install", "--framework", framework),
        );

        expect(suggestedCommands(res.stdout).slice(0, 2)).toEqual([
          `npm --prefix ${dir} install`,
          `npm --prefix ${dir} run dev`,
        ]);
      },
    );

    it.for(FRAMEWORK_APPS)(
      "suggests a deploy dry run next for a $framework app",
      async ({ framework, files }, { dir }) => {
        await write(dir, files);

        const res = await runCliForTest(
          onTheCloud(dir, "--dry-run", "--skip-install", "--framework", framework),
        );

        expect(suggestedCommands(res.stdout)[2]).toBe(
          expectedPublicCliCommand(
            `deploy --dry-run --env-file ${dir}/.env.development.local --cwd ${dir}`,
          ),
        );
      },
    );

    it("names the SDK package it installs in the summary, not the Next.js one", async ({ dir }) => {
      await write(dir, REACT_APP);

      const res = await runCliForTest([
        "setup",
        "--cwd",
        dir,
        "--server",
        CLOUD,
        "--dry-run",
        "--skip-install",
        "--framework",
        "react",
      ]);

      expect(res).toSay("@zitadel/sdk-react");
    });

    it("does not name the Next.js SDK in the summary of another framework", async ({ dir }) => {
      await write(dir, REACT_APP);

      const res = await runCliForTest([
        "setup",
        "--cwd",
        dir,
        "--server",
        CLOUD,
        "--dry-run",
        "--skip-install",
        "--framework",
        "react",
      ]);

      expect(res).not.toSay("@zitadel/sdk-next");
    });

    it("ends its summary with where to find every command", async ({ dir }) => {
      await aNextApp(dir);

      const res = await runCliForTest([
        "setup",
        "--cwd",
        dir,
        "--server",
        CLOUD,
        "--non-interactive",
        "--dry-run",
        "--skip-install",
        "--framework",
        "next",
      ]);

      expect(res).toPrint(`Explore all commands:\n  ${expectedPublicCliCommand("")}`);
    });

    it.for([
      { against: "a new cloud project", server: CLOUD },
      {
        against: "the local server, whose probe a dry run previews optimistically",
        server: "http://localhost:8080",
      },
    ])("tells $against it is temporary until claimed", async ({ server: url }, { dir }) => {
      await aNextApp(dir);

      const res = await runCliForTest(against(dir, url, ...DRY_RUN_NEXT));

      expect(parseJson(res.stdout)).toMatchObject({
        data: {
          next_actions: expect.arrayContaining([
            expect.stringContaining("temporary and its data may be lost"),
          ]),
        },
      });
    });

    it.for([
      { against: "a new cloud project", server: CLOUD },
      { against: "the local server", server: "http://localhost:8080" },
    ])("ends the suggestions for $against with claim", async ({ server: url }, { dir }) => {
      await aNextApp(dir);

      const res = await runCliForTest(against(dir, url, ...DRY_RUN_NEXT));

      expect(suggestedCommands(res.stdout).at(-1)).toMatch(CLAIM_COMMAND);
    });

    it("says nothing about claiming against a self-hosted server", async ({ dir }) => {
      await aNextApp(dir);

      const res = await runCliForTest(against(dir, "https://zitadel.example.com", ...DRY_RUN_NEXT));

      expect(parseJson(res.stdout)).toMatchObject({
        data: {
          next_actions: expect.not.arrayContaining([expect.stringContaining("Claim your Project")]),
        },
      });
    });

    it("suggests no claim against a self-hosted server", async ({ dir }) => {
      await aNextApp(dir);

      const res = await runCliForTest(against(dir, "https://zitadel.example.com", ...DRY_RUN_NEXT));

      expect(suggestedCommands(res.stdout)).not.toContainEqual(expect.stringMatching(/claim/));
    });
  });

  describe("when the detected dev port is taken", () => {
    it("still succeeds", async ({ dir, serve }) => {
      await aNextApp(dir, { scripts: { dev: `next dev -p ${await aHeldPort(serve)}` } });

      const res = await runCliForTest(onTheCloud(dir, ...DRY_RUN_NEXT));

      expect(res).toSucceed();
    });

    it("warns that the port is in use", async ({ dir, serve }) => {
      const port = await aHeldPort(serve);
      await aNextApp(dir, { scripts: { dev: `next dev -p ${port}` } });

      const res = await runCliForTest(onTheCloud(dir, ...DRY_RUN_NEXT));

      expect(parseJson(res.stdout)).toMatchObject({
        warnings: [
          expect.stringContaining(
            `Port ${port} is already in use. If that is not this app's dev server, run setup with a free port: npx @zitadel/cli@`,
          ),
        ],
      });
    });

    it("ends the warning with the setup that picks a free port", async ({ dir, serve }) => {
      await aNextApp(dir, { scripts: { dev: `next dev -p ${await aHeldPort(serve)}` } });

      const res = await runCliForTest(onTheCloud(dir, ...DRY_RUN_NEXT));

      expect(parseJson(res.stdout)).toMatchObject({
        warnings: [expect.stringMatching(/ setup --dev-port \d+ --cwd \S+$/)],
      });
    });
  });

  describe("with --dev-port naming a taken port", () => {
    it("succeeds without a warning, since the port was chosen", async ({ dir, serve }) => {
      const port = await aHeldPort(serve);
      await aNextApp(dir);

      const res = await runCliForTest(onTheCloud(dir, ...DRY_RUN_NEXT, "--dev-port", String(port)));

      expect(parseJson(res.stdout)).toMatchObject({ status: "ok", warnings: [] });
    });
  });

  describe("with --sso google", () => {
    it("reports the enabled providers as a list, which an agent can rely on", async ({ dir }) => {
      await aNextApp(dir);

      const res = await runCliForTest(
        onTheCloud(dir, ...DRY_RUN_NEXT, "--sso", "google", "--sso-client-id", GOOGLE_CLIENT_ID),
      );

      expect(parseJson(res.stdout)).toMatchObject({
        status: "ok",
        data: {
          sso: [
            {
              provider: "google",
              client_id: GOOGLE_CLIENT_ID,
              connection: ".zitadel/idps/google.json",
            },
          ],
        },
      });
    });

    it("reports the connection's callback URI, which a JSON run shows no prompt for", async ({
      dir,
    }) => {
      await aNextApp(dir);

      const res = await runCliForTest(
        onTheCloud(dir, ...DRY_RUN_NEXT, "--sso", "google", "--sso-client-id", GOOGLE_CLIENT_ID),
      );

      expect(parseJson(res.stdout)).toMatchObject({
        data: {
          sso: [
            {
              callback_uri: expect.stringMatching(
                /^http:\/\/localhost:\d+\/__nextgen\/idp\/google\/callback$/,
              ),
            },
          ],
        },
      });
    });

    describe("run without --json", () => {
      it("names the redirect URI in its summary, the only place a scripted run shows it", async ({
        dir,
      }) => {
        await aNextApp(dir);

        const res = await runCliForTest([
          "setup",
          "--cwd",
          dir,
          "--server",
          CLOUD,
          "--non-interactive",
          "--skip-install",
          ...DRY_RUN_NEXT,
          "--sso",
          "google",
          "--sso-client-id",
          GOOGLE_CLIENT_ID,
        ]);

        expect(res).toSay("Redirect URI");
      });

      it("prints the redirect URI to register", async ({ dir }) => {
        await aNextApp(dir);

        const res = await runCliForTest([
          "setup",
          "--cwd",
          dir,
          "--server",
          CLOUD,
          "--non-interactive",
          "--skip-install",
          ...DRY_RUN_NEXT,
          "--sso",
          "google",
          "--sso-client-id",
          GOOGLE_CLIENT_ID,
        ]);

        expect(`${res.stdout}${res.stderr}`).toMatch(
          /http:\/\/localhost:\d+\/__nextgen\/idp\/google\/callback/,
        );
      });
    });
  });

  describe("with no provider", () => {
    it("reports an empty list, so a consumer never checks which shape it holds", async ({
      dir,
    }) => {
      await aNextApp(dir);

      const res = await runCliForTest(onTheCloud(dir, ...DRY_RUN_NEXT));

      expect(parseJson(res.stdout)).toMatchObject({ data: { sso: [] } });
    });
  });

  describe("with a custom provider", () => {
    it("reports it under the slug the developer gave it", async ({ dir }) => {
      await aNextApp(dir);

      const res = await runCliForTest(
        onTheCloud(dir, ...DRY_RUN_NEXT, ...ACME, "--sso-client-id", "acme-client-id"),
      );

      expect(parseJson(res.stdout)).toMatchObject({
        status: "ok",
        data: {
          sso: [
            {
              provider: "custom",
              slug: "acme-sso",
              client_id: "acme-client-id",
              connection: ".zitadel/idps/acme-sso.json",
            },
          ],
        },
      });
    });

    it("refuses one described in part before anything is created, naming what it lacks", async ({
      dir,
    }) => {
      await aNextApp(dir);

      const res = await runCliForTest(
        onTheCloud(
          dir,
          "--framework",
          "next",
          "--sso",
          "custom",
          "--sso-slug",
          "acme-sso",
          "--sso-client-id",
          "acme-client-id",
        ),
      );

      expect(res).toFailWith("E_VALIDATION");
      expect(parseJson(res.stdout)).toMatchObject({
        message: "A custom connection needs --sso-display-name, --sso-issuer",
      });
    });

    it("refuses a slug belonging to a built-in provider", async ({ dir }) => {
      await aNextApp(dir);

      const res = await runCliForTest(
        onTheCloud(
          dir,
          ...DRY_RUN_NEXT,
          "--sso",
          "custom",
          "--sso-slug",
          "google",
          "--sso-display-name",
          "Mine",
          "--sso-issuer",
          "https://sso.acme.example",
          "--sso-client-id",
          "id",
        ),
      );

      expect(res).toFail();
      expect(res).toExplain("built-in provider");
    });

    it("refuses the --sso-* description for a provider the catalog describes", async ({ dir }) => {
      await aNextApp(dir);

      const res = await runCliForTest(
        onTheCloud(
          dir,
          ...DRY_RUN_NEXT,
          "--sso",
          "google",
          "--sso-issuer",
          "https://sso.acme.example",
          "--sso-client-id",
          "id",
        ),
      );

      expect(res).toFail();
      expect(parseJson(res.stdout)).toMatchObject({
        message: "--sso-issuer only applies to a custom connection",
      });
    });

    it("refuses a description with no --sso to attach it to", async ({ dir }) => {
      await aNextApp(dir);

      const res = await runCliForTest(onTheCloud(dir, ...DRY_RUN_NEXT, "--sso-slug", "acme-sso"));

      expect(res).toFail();
      expect(parseJson(res.stdout)).toMatchObject({ message: "--sso-slug needs --sso custom" });
    });
  });

  describe("with a custom provider described in part", () => {
    it("refuses with E_VALIDATION when the run cannot ask, whatever the server is doing", async ({
      dir,
    }) => {
      const res = await runCliForTest(onTheCloud(dir, "--sso", "custom", "--sso-slug", "acme-sso"));

      expect(res).toFailWith("E_VALIDATION");
    });

    it("refuses with E_VALIDATION before it looks for the local server", async ({ dir }) => {
      const res = await runCliForTest(
        against(dir, "local", "--sso", "custom", "--sso-slug", "acme-sso"),
      );

      expect(res).toFailWith("E_VALIDATION");
    });

    it("shows the example with setup's own flags", async ({ dir }) => {
      const res = await runCliForTest(onTheCloud(dir, "--sso", "custom", "--sso-slug", "acme-sso"));

      expect(res).toHintAt(customExample(SETUP_FLAG_NAMES));
    });

    it("refuses a setting that is wrong before anything else", async ({ dir }) => {
      const res = await runCliForTest(onTheCloud(dir, "--sso", "custom", "--sso-slug", "Acme"));

      expect(res).toExplain("--sso-slug");
    });
  });

  describe("against a platform that creates the project", () => {
    it("creates it with a name, the primary origin and no server default seeding", async ({
      dir,
    }) => {
      await aNextApp(dir);
      const createBodies: unknown[] = [];
      server.use(
        http.post("*/projects", async ({ request }) => {
          createBodies.push(await request.json());
          return HttpResponse.json(
            {
              id: "proj-test",
              name: "demo",
              project_secret: "sk_proj_test_full",
              preview_secret: "sk_proj_test_preview",
              origins: [{ pattern: "http://localhost:3000", kind: "primary" }],
              created_at: "2026-04-21T14:03:11.000Z",
            },
            { status: 201 },
          );
        }),
      );

      await runCliForTest(onTheCloud(dir, ...SCRIPTED_NEXT));

      expect(createBodies).toMatchObject([
        {
          name: expect.stringMatching(/\S/),
          origins: expect.arrayContaining([{ pattern: "http://localhost:3000", kind: "primary" }]),
          seed_defaults: false,
        },
      ]);
    });
  });

  describe("when the platform cannot create the project", () => {
    it("refuses", async ({ dir }) => {
      await aNextApp(dir);
      server.use(refusingProjects());

      const res = await runCliForTest(onTheCloud(dir, ...SCRIPTED_NEXT));

      expect(res).toFail();
      expect(parseJson(res.stdout)).toMatchObject({ status: "error" });
    });

    it.for([
      ["--use-case", "business"],
      ["--password-min-length", "12"],
    ])(
      "carries %s %s into the retry it suggests, which agents follow literally",
      async (flag, { dir }) => {
        await aNextApp(dir);
        server.use(refusingProjects());

        const res = await runCliForTest(onTheCloud(dir, ...SCRIPTED_NEXT, ...flag));

        expect(res).toPrint(flag.join(" "));
      },
    );
  });

  describe("against a local server hosting the platform", () => {
    describe("with a local admin in a parent directory", () => {
      it("attaches the project to the admin's team", async ({ dir }) => {
        await aLocalAdmin(dir);
        await recordStartedServer(dir, LOCAL_SERVER);
        const cwd = join(dir, "my-app");
        await aNextApp(cwd);
        server.use(hostingThePlatform(LOCAL_SERVER), ...signingInTheAdmin(LOCAL_SERVER));

        await runCliForTest(against(cwd, LOCAL_SERVER, ...SCRIPTED_NEXT));

        expect(await readZitadelSecret(cwd)).toMatchObject({ team_id: "team_localadmin" });
      });

      it.for([
        {
          suggestion: "the console",
          command: (cwd: string) => {
            return `console --cwd ${cwd}`;
          },
        },
        {
          suggestion: "enabling Google sign-in",
          command: (cwd: string) => {
            return `auth-method sso enable --provider google --env-file ${cwd}/.env.development.local --cwd ${cwd}`;
          },
        },
      ])("suggests $suggestion", async ({ command }, { dir }) => {
        await aLocalAdmin(dir);
        await recordStartedServer(dir, LOCAL_SERVER);
        const cwd = join(dir, "my-app");
        await aNextApp(cwd);
        server.use(hostingThePlatform(LOCAL_SERVER), ...signingInTheAdmin(LOCAL_SERVER));

        const res = await runCliForTest(against(cwd, LOCAL_SERVER, ...SCRIPTED_NEXT));

        expect(suggestedCommands(res.stdout)).toContain(expectedPublicCliCommand(command(cwd)));
      });

      it("says to manage the project in the local console as the admin", async ({ dir }) => {
        await aLocalAdmin(dir);
        await recordStartedServer(dir, LOCAL_SERVER);
        const cwd = join(dir, "my-app");
        await aNextApp(cwd);
        server.use(hostingThePlatform(LOCAL_SERVER), ...signingInTheAdmin(LOCAL_SERVER));

        const res = await runCliForTest(against(cwd, LOCAL_SERVER, ...SCRIPTED_NEXT));

        expect(parseJson(res.stdout)).toMatchObject({
          data: {
            next_actions: expect.arrayContaining([
              expect.stringContaining(
                "Manage the project in the local console as admin@zitadel.localhost",
              ),
            ]),
          },
        });
      });
    });

    describe("when attaching the project to the local admin fails", () => {
      it("still succeeds, since a claim that can complete is not guaranteed", async ({ dir }) => {
        await aNextApp(dir);
        await aLocalAdmin(dir);
        await recordStartedServer(dir, LOCAL_SERVER);
        server.use(
          hostingThePlatform(LOCAL_SERVER),
          http.post(`${LOCAL_SERVER}/api/v1/projects/:projectId/claim/init`, () => {
            return HttpResponse.json(
              { code: "internal", message: "claim unavailable" },
              { status: 500 },
            );
          }),
        );

        const res = await runCliForTest(against(dir, LOCAL_SERVER, ...SCRIPTED_NEXT));

        expect(res).toSucceed();
      });

      it("keeps the project unclaimed", async ({ dir }) => {
        await aNextApp(dir);
        await aLocalAdmin(dir);
        await recordStartedServer(dir, LOCAL_SERVER);
        server.use(
          hostingThePlatform(LOCAL_SERVER),
          http.post(`${LOCAL_SERVER}/api/v1/projects/:projectId/claim/init`, () => {
            return HttpResponse.json(
              { code: "internal", message: "claim unavailable" },
              { status: 500 },
            );
          }),
        );

        await runCliForTest(against(dir, LOCAL_SERVER, ...SCRIPTED_NEXT));

        expect(await readZitadelSecret(dir)).not.toHaveProperty("team_id");
      });

      it("ends its suggestions with claim", async ({ dir }) => {
        await aNextApp(dir);
        await aLocalAdmin(dir);
        await recordStartedServer(dir, LOCAL_SERVER);
        server.use(
          hostingThePlatform(LOCAL_SERVER),
          http.post(`${LOCAL_SERVER}/api/v1/projects/:projectId/claim/init`, () => {
            return HttpResponse.json(
              { code: "internal", message: "claim unavailable" },
              { status: 500 },
            );
          }),
        );

        const res = await runCliForTest(against(dir, LOCAL_SERVER, ...SCRIPTED_NEXT));

        expect(suggestedCommands(res.stdout).at(-1)).toMatch(CLAIM_COMMAND);
      });
    });

    describe("with no local admin here", () => {
      it("still succeeds", async ({ dir }) => {
        await aNextApp(dir);
        server.use(hostingThePlatform(LOCAL_SERVER));

        const res = await runCliForTest(
          against(dir, LOCAL_SERVER, ...SCRIPTED_NEXT, "--no-git", ...PINNED_DEV_PORT),
          homeAt(dir),
        );

        expect(res).toSucceed();
      });

      it.for([
        {
          saying: "no local admin was found here or above",
          said: (cwd: string) => {
            return `No local admin for ${LOCAL_SERVER} in ${cwd} or its parents`;
          },
        },
        {
          saying: "what to do if zitadel start started the server",
          said: () => {
            return "If `zitadel start` started this server";
          },
        },
      ])("warns once, saying $saying", async ({ said }, { dir }) => {
        await aNextApp(dir);
        server.use(hostingThePlatform(LOCAL_SERVER));

        const res = await runCliForTest(
          against(dir, LOCAL_SERVER, ...SCRIPTED_NEXT, "--no-git", ...PINNED_DEV_PORT),
          homeAt(dir),
        );

        expect(parseJson(res.stdout)).toMatchObject({
          warnings: [expect.stringContaining(said(dir))],
        });
      });

      it("keeps the missing admin out of the next actions", async ({ dir }) => {
        await aNextApp(dir);
        server.use(hostingThePlatform(LOCAL_SERVER));

        const res = await runCliForTest(
          against(dir, LOCAL_SERVER, ...SCRIPTED_NEXT, "--no-git", ...PINNED_DEV_PORT),
          homeAt(dir),
        );

        expect(parseJson(res.stdout)).toMatchObject({
          data: {
            next_actions: expect.not.arrayContaining([expect.stringContaining("No local admin")]),
          },
        });
      });

      it("does not suggest the console, which has no project to manage", async ({ dir }) => {
        await aNextApp(dir);
        server.use(hostingThePlatform(LOCAL_SERVER));

        const res = await runCliForTest(
          against(dir, LOCAL_SERVER, ...SCRIPTED_NEXT, "--no-git", ...PINNED_DEV_PORT),
          homeAt(dir),
        );

        expect(suggestedCommands(res.stdout)).not.toContainEqual(
          expect.stringMatching(/ console$/),
        );
      });
    });

    describe("with a local admin that belongs to another server", () => {
      it("passes over it, asking that server nothing", async ({ dir }) => {
        await aNextApp(dir);
        await aLocalAdmin(dir);
        await recordStartedServer(dir, "http://localhost:9999");
        server.use(hostingThePlatform(LOCAL_SERVER));

        const res = await runCliForTest(
          against(dir, LOCAL_SERVER, ...SCRIPTED_NEXT, "--no-git", ...PINNED_DEV_PORT),
          homeAt(dir),
        );

        expect(parseJson(res.stdout)).toMatchObject({
          warnings: [expect.stringContaining(`No local admin for ${LOCAL_SERVER}`)],
        });
      });
    });
  });

  describe("in an empty directory, run non-interactively without --framework", () => {
    it("refuses with E_FRAMEWORK_NOT_DETECTED, listing the frameworks in the details", async ({
      dir,
    }) => {
      const res = await runCliForTest(onTheCloud(dir));

      expect(res).toFailWith("E_FRAMEWORK_NOT_DETECTED");
      expect(parseJson(res.stdout)).toMatchObject({
        details: { frameworks: expect.arrayContaining(["next"]) },
      });
    });

    it.for(["only in a terminal", "next, nuxt"])(
      "hints %s, rather than prompting a caller who cannot see it",
      async (hinted, { dir }) => {
        const res = await runCliForTest(onTheCloud(dir));

        expect(res).toHintAt(hinted);
      },
    );

    it("suggests no rerun, since it would pin a --server local this run did not ask for", async ({
      dir,
    }) => {
      const res = await runCliForTest(onTheCloud(dir));

      expect(suggestedCommands(res.stdout)).toEqual([]);
    });
  });

  describe("when the default configuration of a new app cannot be written", () => {
    it("says the new app is gone again", async ({ dir }) => {
      const cwd = await aNewAppDirectory(dir);
      server.use(
        http.post("*/projects", async () => {
          await write(cwd, { ".zitadel/policies": "" });
        }),
      );

      const res = await runCliForTest(onTheCloud(cwd, ...SCRIPTED_NEXT), {
        PATH: await aFakeAppGeneratorPath(),
      });

      expect(res).toHintAt("so setup removed the new app again");
    });

    it("does not suggest --force, which the emptied directory does not need", async ({ dir }) => {
      const cwd = await aNewAppDirectory(dir);
      server.use(
        http.post("*/projects", async () => {
          await write(cwd, { ".zitadel/policies": "" });
        }),
      );

      const res = await runCliForTest(onTheCloud(cwd, ...SCRIPTED_NEXT), {
        PATH: await aFakeAppGeneratorPath(),
      });

      expect(suggestedCommands(res.stdout)).toEqual([]);
    });
  });

  describe("with a flag it cannot use", () => {
    it.for(["0", "65536", "many"])(
      "refuses a --dev-port of %s, saying it is not a TCP port",
      async (port, { dir }) => {
        await aNextApp(dir);

        const res = await runCliForTest(onTheCloud(dir, ...DRY_RUN_NEXT, "--dev-port", port));

        expect(res).toFailWith("E_VALIDATION");
        expect(res).toExplain(`${port} is not a TCP port`);
      },
    );

    it("refuses a --password-min-length the policy would not accept, with the reason", async ({
      dir,
    }) => {
      await aNextApp(dir);

      const res = await runCliForTest(
        onTheCloud(dir, ...DRY_RUN_NEXT, "--password-min-length", "many"),
      );

      expect(res).toFailWith("E_VALIDATION");
      expect(res).toExplain("Must be a whole number from 1 to");
    });

    it("refuses --design, which setup no longer applies", async ({ dir }) => {
      await aNextApp(dir);

      const res = await runCliForTest(onTheCloud(dir, ...DRY_RUN_NEXT, "--design", "centered"));

      expect(res).toFail();
      expect(parseJson(res.stdout)).toMatchObject({
        message: "setup no longer applies a login template, so --design was removed",
      });
    });

    it("refuses a --sso-client-id with no --sso to attach it to, saying how to name one", async ({
      dir,
    }) => {
      await aNextApp(dir);

      const res = await runCliForTest(onTheCloud(dir, ...DRY_RUN_NEXT, "--sso-client-id", "abc"));

      expect(res).toFail();
      expect(parseJson(res.stdout)).toMatchObject({
        message: "--sso-client-id needs --sso",
        hint: "Name the provider with --sso, e.g. --sso google.",
      });
    });
  });

  describe("on an app already set up, with a --dev-port to move it to", () => {
    it("reports the move from the previous issuer to the new one", async ({ dir }) => {
      await aNextApp(dir, { scripts: { dev: "next dev" } });
      await runCliForTest(onTheCloud(dir, "--non-interactive", "--skip-install"));

      const res = await runCliForTest(onTheCloud(dir, ...MOVE_TO_3101, "--force"));

      expect(parseJson(res.stdout)).toMatchObject({
        status: "ok",
        data: {
          moved: true,
          previous_issuer: "http://localhost:3000",
          issuer: "http://localhost:3101",
        },
      });
    });

    it.for([
      {
        file: "the dev script",
        path: "package.json",
        moved: { scripts: { dev: "next dev --port 3101" } },
      },
      {
        file: "the development issuer in zitadel.json",
        path: "zitadel.json",
        moved: { environments: { development: { issuer: "http://localhost:3101" } } },
      },
      {
        file: "the primary origin .zitadel/secret records",
        path: ".zitadel/secret",
        moved: { primary_origins: ["http://localhost:3101"] },
      },
    ])("moves $file", async ({ path, moved }, { dir }) => {
      await aNextApp(dir, { scripts: { dev: "next dev" } });
      await runCliForTest(onTheCloud(dir, "--non-interactive", "--skip-install"));

      await runCliForTest(onTheCloud(dir, ...MOVE_TO_3101, "--force"));

      expect(await readJsonAt(dir, path)).toMatchObject(moved);
    });

    it.for([
      {
        file: "the issuer in .env.local",
        path: ".env.local",
        moved: "ZITADEL_ISSUER=http://localhost:3101\n",
      },
      {
        file: "the README's register link",
        path: "README.md",
        moved: "http://localhost:3101/register",
      },
    ])("moves $file", async ({ path, moved }, { dir }) => {
      await aNextApp(dir, { scripts: { dev: "next dev" } });
      await runCliForTest(onTheCloud(dir, "--non-interactive", "--skip-install"));

      await runCliForTest(onTheCloud(dir, ...MOVE_TO_3101, "--force"));

      expect(await readFile(join(dir, path), "utf8")).toContain(moved);
    });

    it("moves the project's allowed origin", async ({ dir }) => {
      await aNextApp(dir, { scripts: { dev: "next dev" } });
      await runCliForTest(onTheCloud(dir, "--non-interactive", "--skip-install"));

      await runCliForTest(onTheCloud(dir, ...MOVE_TO_3101, "--force"));

      expect(await projectOrigins(dir)).toEqual([
        { pattern: "http://localhost:3101", kind: "primary" },
      ]);
    });

    it("serves the new port the release the previous port ran", async ({ dir }) => {
      await aNextApp(dir, { scripts: { dev: "next dev" } });
      await runCliForTest(onTheCloud(dir, "--non-interactive", "--skip-install"));
      const [before] = await liveDeployments(dir);

      await runCliForTest(onTheCloud(dir, ...MOVE_TO_3101, "--force"));

      expect(await liveDeployments(dir)).toContainEqual(
        expect.objectContaining({
          release_id: before?.release_id,
          targets: expect.arrayContaining([
            expect.objectContaining({ origin: "http://localhost:3101" }),
          ]),
        }),
      );
    });

    it("names the deployment that serves the new port", async ({ dir }) => {
      await aNextApp(dir, { scripts: { dev: "next dev" } });
      await runCliForTest(onTheCloud(dir, "--non-interactive", "--skip-install"));

      const res = await runCliForTest(onTheCloud(dir, ...MOVE_TO_3101, "--force"));

      expect(parseJson(res.stdout)).toMatchObject({
        data: {
          deployment_id: expect.toBeOneOf(
            (await liveDeployments(dir)).map((deployment) => {
              return deployment.id;
            }),
          ),
        },
      });
    });

    it("reports nothing moved for the port the app is already on", async ({ dir }) => {
      await aNextApp(dir, { scripts: { dev: "next dev" } });
      await runCliForTest(onTheCloud(dir, "--non-interactive", "--skip-install"));

      const res = await runCliForTest(onTheCloud(dir, "--non-interactive", "--dev-port", "3000"));

      expect(parseJson(res.stdout)).toMatchObject({ status: "ok", data: { moved: false } });
    });

    it("keeps the project's origin for the port the app is already on", async ({ dir }) => {
      await aNextApp(dir, { scripts: { dev: "next dev" } });
      await runCliForTest(onTheCloud(dir, "--non-interactive", "--skip-install"));

      await runCliForTest(onTheCloud(dir, "--non-interactive", "--dev-port", "3000"));

      expect(await projectOrigins(dir)).toEqual([
        { pattern: "http://localhost:3000", kind: "primary" },
      ]);
    });

    it("refuses a port outside 1..65535", async ({ dir }) => {
      await aNextApp(dir, { scripts: { dev: "next dev" } });
      await runCliForTest(onTheCloud(dir, "--non-interactive", "--skip-install"));

      const res = await runCliForTest(onTheCloud(dir, "--non-interactive", "--dev-port", "70000"));

      expect(res).toFailWith("E_VALIDATION");
    });

    describe("when nothing is deployed for the new port to serve", () => {
      it("warns that the new port serves nothing until the next deploy", async ({ dir }) => {
        await aNextApp(dir, { scripts: { dev: "next dev" } });
        await runCliForTest(onTheCloud(dir, "--non-interactive", "--skip-install"));
        server.use(
          http.get("*/deployments", () => {
            return HttpResponse.json({ deployments: [] });
          }),
        );

        const res = await runCliForTest(onTheCloud(dir, ...MOVE_TO_3101, "--force"));

        expect(parseJson(res.stdout)).toMatchObject({
          warnings: expect.arrayContaining([
            expect.stringMatching(
              /^http:\/\/localhost:3101 serves nothing until the next deploy: nothing is deployed to the project yet\. Run `\S+ \S+ deploy .+`\.$/,
            ),
          ]),
        });
      });

      it("suggests the deploy", async ({ dir }) => {
        await aNextApp(dir, { scripts: { dev: "next dev" } });
        await runCliForTest(onTheCloud(dir, "--non-interactive", "--skip-install"));
        server.use(
          http.get("*/deployments", () => {
            return HttpResponse.json({ deployments: [] });
          }),
        );

        const res = await runCliForTest(onTheCloud(dir, ...MOVE_TO_3101, "--force"));

        expect(suggestedCommands(res.stdout)).toEqual([expect.stringContaining(" deploy -m ")]);
      });
    });

    describe("without --force, since nobody can be asked", () => {
      it("keeps the previous origin", async ({ dir }) => {
        await aNextApp(dir, { scripts: { dev: "next dev" } });
        await runCliForTest(onTheCloud(dir, "--non-interactive", "--skip-install"));

        await runCliForTest(onTheCloud(dir, ...MOVE_TO_3101));

        expect(await projectOrigins(dir)).toContainEqual({
          pattern: "http://localhost:3000",
          kind: "primary",
        });
      });

      it("warns that the previous origin was kept, with the command that removes it", async ({
        dir,
      }) => {
        await aNextApp(dir, { scripts: { dev: "next dev" } });
        await runCliForTest(onTheCloud(dir, "--non-interactive", "--skip-install"));

        const res = await runCliForTest(onTheCloud(dir, ...MOVE_TO_3101));

        expect(parseJson(res.stdout)).toMatchObject({
          warnings: expect.arrayContaining([
            expect.stringMatching(
              /^http:\/\/localhost:3000 is still among the project's origins; it admits a port nothing serves any more\. Remove it with `\S+ \S+ origin rm http:\/\/localhost:3000 --force .+`\.$/,
            ),
          ]),
        });
      });

      it.for([
        {
          situation: "with --force",
          suggested: () => {
            return "origin rm http://localhost:3000 --force";
          },
        },
        {
          situation: "from the project it moved",
          suggested: (cwd: string) => {
            return `--env-file ${cwd}/.env.development.local`;
          },
        },
      ])("suggests removing the previous origin $situation", async ({ suggested }, { dir }) => {
        await aNextApp(dir, { scripts: { dev: "next dev" } });
        await runCliForTest(onTheCloud(dir, "--non-interactive", "--skip-install"));

        const res = await runCliForTest(onTheCloud(dir, ...MOVE_TO_3101));

        expect(suggestedCommands(res.stdout)).toEqual([expect.stringContaining(suggested(dir))]);
      });

      it("pins the removal to the server it moved on, for a project with no env file", async ({
        dir,
      }) => {
        await aNextApp(dir, { scripts: { dev: "next dev" } });
        await runCliForTest(onTheCloud(dir, "--non-interactive", "--skip-install"));
        await rm(join(dir, ".env.development.local"), { force: true });

        const res = await runCliForTest(onTheCloud(dir, ...MOVE_TO_3101));

        expect(suggestedCommands(res.stdout)).toEqual([
          expect.stringContaining("origin rm http://localhost:3000 --force --server "),
        ]);
      });
    });

    describe("when the server refuses the new origin", () => {
      it("fails", async ({ dir }) => {
        await aNextApp(dir, { scripts: { dev: "next dev" } });
        await runCliForTest(onTheCloud(dir, "--non-interactive", "--skip-install"));
        server.use(
          http.post("*/projects/:project_id/origins", () => {
            return HttpResponse.json({ code: "unavailable", message: "down" }, { status: 503 });
          }),
        );

        const res = await runCliForTest(onTheCloud(dir, ...MOVE_TO_3101));

        expect(res).toFail();
      });

      it.for(["package.json", ".env.local"])("leaves %s as it was", async (path, { dir }) => {
        await aNextApp(dir, { scripts: { dev: "next dev" } });
        await runCliForTest(onTheCloud(dir, "--non-interactive", "--skip-install"));
        const before = await readFile(join(dir, path), "utf8");
        server.use(
          http.post("*/projects/:project_id/origins", () => {
            return HttpResponse.json({ code: "unavailable", message: "down" }, { status: 503 });
          }),
        );

        await runCliForTest(onTheCloud(dir, ...MOVE_TO_3101));

        expect(await readFile(join(dir, path), "utf8")).toBe(before);
      });
    });
  });
});

describe("Setup.run", () => {
  beforeEach(() => {
    vi.spyOn(LocalServer, "isPortFree").mockResolvedValue(true);
  });

  it("still asks whether to proceed with the detected framework when --force is given", async ({
    dir,
  }) => {
    await aNextApp(dir);
    vi.mocked(confirm).mockResolvedValueOnce(false);

    await rejectionOf(() => {
      return asTerminal(() => {
        return Setup.run(["--cwd", dir, "--server", CLOUD, "--force"]);
      });
    });

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Would you like to set up Zitadel in this Next.js app?" }),
    );
  });

  describe("when the framework is declined", () => {
    it("stops", async ({ dir }) => {
      await aNextApp(dir);
      vi.mocked(confirm).mockResolvedValueOnce(false);

      const error = await rejectionOf(() => {
        return asTerminal(() => {
          return Setup.run(["--cwd", dir, "--server", CLOUD]);
        });
      });

      expect(error).toBeInstanceOf(Error);
    });

    it("writes no zitadel.json", async ({ dir }) => {
      await aNextApp(dir);
      vi.mocked(confirm).mockResolvedValueOnce(false);

      await rejectionOf(() => {
        return asTerminal(() => {
          return Setup.run(["--cwd", dir, "--server", CLOUD]);
        });
      });

      expect(existsSync(join(dir, "zitadel.json"))).toBe(false);
    });
  });

  describe("in a directory without an app", () => {
    beforeEach(async () => {
      vi.stubEnv("PATH", await aFakeAppGeneratorPath());
      vi.mocked(isCancel).mockImplementation((value) => {
        return value === CANCELLED;
      });
      vi.mocked(intro).mockClear();
    });

    /**
     * Picks Next.js to scaffold, then answers every question after it: the
     * fields, the sign-in method, the password minimum and the providers. The
     * port is free, so it is not asked.
     */
    function answeringEveryQuestion(): void {
      vi.mocked(select)
        .mockResolvedValueOnce("next")
        .mockResolvedValueOnce(DEFAULT_SETUP_USE_CASE)
        .mockResolvedValueOnce(DEFAULT_SETUP_PRESET)
        .mockResolvedValueOnce(15);
      vi.mocked(multiselect).mockResolvedValueOnce([]);
    }

    /**
     * Picks Next.js to scaffold, then cancels the question after it.
     */
    function cancellingAfterTheFramework(): void {
      vi.mocked(select).mockResolvedValueOnce("next").mockResolvedValueOnce(CANCELLED);
    }

    describe("when a question after the framework is cancelled", () => {
      it("exits 130, as Ctrl-C does anywhere", async ({ dir }) => {
        const cwd = await aNewAppDirectory(dir);
        cancellingAfterTheFramework();

        const error = await rejectionOf(() => {
          return asTerminal(() => {
            return Setup.run(["--cwd", cwd, "--server", CLOUD]);
          });
        });

        expect(error).toBeInstanceOf(Error);
        expect(error).toMatchObject({ oclif: { exit: 130 } });
      });

      it("asks nothing after the cancelled question", async ({ dir }) => {
        const cwd = await aNewAppDirectory(dir);
        cancellingAfterTheFramework();

        await rejectionOf(() => {
          return asTerminal(() => {
            return Setup.run(["--cwd", cwd, "--server", CLOUD]);
          });
        });

        expect(select).toHaveBeenLastCalledWith(
          expect.objectContaining({
            message: expect.stringContaining("Which fields should registration collect?"),
          }),
        );
      });

      it("creates no app", async ({ dir }) => {
        const cwd = await aNewAppDirectory(dir);
        cancellingAfterTheFramework();

        await rejectionOf(() => {
          return asTerminal(() => {
            return Setup.run(["--cwd", cwd, "--server", CLOUD]);
          });
        });

        expect(await readdir(cwd)).toEqual([]);
      });
    });

    describe("when every question is answered", () => {
      it("creates the app", async ({ dir }) => {
        const cwd = await aNewAppDirectory(dir);
        answeringEveryQuestion();

        await asTerminal(() => {
          return Setup.run(["--cwd", cwd, "--server", CLOUD, "--skip-install"]);
        });

        expect(await readdir(cwd)).toEqual(expect.arrayContaining(["app", "zitadel.json"]));
      });

      it("asks every question under the heading the framework question opened", async ({ dir }) => {
        const cwd = await aNewAppDirectory(dir);
        answeringEveryQuestion();

        await asTerminal(() => {
          return Setup.run(["--cwd", cwd, "--server", CLOUD, "--skip-install"]);
        });

        expect(intro).toHaveBeenCalledTimes(1);
      });
    });
  });
});

describe("portInUseWarning", () => {
  it("names only the flag when the ports after the taken one are taken too, since a placeholder would run as a shell redirection", () => {
    const warning = portInUseWarning(3000, undefined, (args) => {
      return unscopedCommand(args, "1.2.3");
    });

    expect(warning).toBe(
      "Port 3000 and the ports after it are already in use. If that is not this app's dev server, run setup with --dev-port and a free port.",
    );
  });
});

describe("localServerHostsPlatform", () => {
  it.each([
    {
      situation: "a runtime document naming the platform project",
      answer: () => {
        return HttpResponse.json(PLATFORM_RUNTIME);
      },
      hosts: true,
    },
    {
      situation: "a runtime document naming another project",
      answer: () => {
        return HttpResponse.json({ mode: "standalone", console_project_id: "proj_someone" });
      },
      hosts: false,
    },
    {
      situation: "no runtime document",
      answer: () => {
        return HttpResponse.json({ error: "nope" }, { status: 404 });
      },
      hosts: false,
    },
    {
      situation: "a server that does not answer",
      answer: () => {
        return HttpResponse.error();
      },
      hosts: false,
    },
  ])(
    "is $hosts for $situation, failing closed so setup never nudges into a claim that would fail",
    async ({ answer, hosts }) => {
      server.use(http.get(`${LOCAL_SERVER}/console/runtime.json`, answer));

      const hosting = await localServerHostsPlatform(LOCAL_SERVER);

      expect(hosting).toBe(hosts);
    },
  );
});

describe("setupRetryFlags", () => {
  it.each([
    {
      situation: "the custom settings typed, though they do not make a connection yet",
      flags: { sso: "custom", ssoSlug: "acme-sso" },
      carried: "--sso custom --sso-slug acme-sso",
    },
    {
      situation: "what was typed, quoted for a shell",
      flags: { sso: "custom", ssoSlug: "acme-sso", ssoDisplayName: "Acme's SSO" },
      carried: "--sso-display-name 'Acme'\\''s SSO'",
    },
    {
      situation: "a whole connection as before",
      flags: {
        sso: "custom",
        ssoSlug: "acme-sso",
        ssoDisplayName: "Acme",
        ssoIssuer: "https://sso.acme.example",
      },
      carried: "--sso-issuer https://sso.acme.example",
    },
    {
      situation: "the minimum password length",
      flags: { passwordMinLength: 12 },
      carried: "--password-min-length 12",
    },
    {
      situation: "an explicit no minimum as 0",
      flags: { passwordMinLength: null },
      carried: "--password-min-length 0",
    },
    {
      situation: "the recommended minimum, which a policy file --force keeps would not hold",
      flags: { passwordMinLength: 15 },
      carried: "--password-min-length 15",
    },
  ])("carries $situation", ({ flags, carried }) => {
    const retry = setupRetryFlags(retryOptionsFromFlags(flags));

    expect(retry).toContain(carried);
  });

  it.each([
    {
      situation: "--non-interactive while a provider is being configured, typed in part or not",
      flags: { sso: "custom", ssoSlug: "acme-sso", nonInteractive: true },
      dropped: "--non-interactive",
    },
    {
      situation: "a provider this CLI does not offer",
      flags: { sso: "nonesuch", ssoSlug: "acme-sso" },
      dropped: "--sso",
    },
  ])("drops $situation", ({ flags, dropped }) => {
    const retry = setupRetryFlags(retryOptionsFromFlags(flags));

    expect(retry).not.toContain(dropped);
  });
});

describe("ssoFromFlags", () => {
  describe("with a custom provider described in part", () => {
    const partial = { sso: "custom", ssoSlug: "acme-sso" };

    beforeEach(() => {
      vi.mocked(askCustomSettings).mockReset();
    });

    it("has the settings it was not given asked for when a person is there", async () => {
      vi.mocked(askCustomSettings).mockResolvedValueOnce({
        slug: "acme-sso",
        displayName: "Acme",
        issuer: "https://sso.acme.example",
        scopes: "openid",
      });

      const draft = await ssoFromFlags(partial, false, false, ask, "0.0.0-test");

      expect(draft?.selection).toMatchObject({
        kind: "custom",
        connection: { displayName: "Acme" },
      });
    });

    it("asks with what was already typed", async () => {
      vi.mocked(askCustomSettings).mockResolvedValueOnce({
        slug: "acme-sso",
        displayName: "Acme",
        issuer: "https://sso.acme.example",
        scopes: "openid",
      });

      await ssoFromFlags(partial, false, false, ask, "0.0.0-test");

      expect(askCustomSettings).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "acme-sso" }),
        ask,
      );
    });

    describe("when nobody is there to answer", () => {
      it("refuses with E_VALIDATION", async () => {
        const error = await rejectionOf(() => {
          return ssoFromFlags(partial, true, false, ask, "0.0.0-test");
        });

        expect(error).toBeInstanceOf(ZitadelError);
        expect(error).toMatchObject({ code: "E_VALIDATION" });
      });

      it("does not ask", async () => {
        await rejectionOf(() => {
          return ssoFromFlags(partial, true, false, ask, "0.0.0-test");
        });

        expect(askCustomSettings).not.toHaveBeenCalled();
      });
    });
  });
});

describe("moveDevPort", () => {
  it("stops when asking to remove the previous origin fails for a reason other than a refusal", async ({
    dir,
  }) => {
    await aNextApp(dir, { scripts: { dev: "next dev" } });
    await runCliForTest(onTheCloud(dir, "--non-interactive", "--skip-install"));

    const error = await rejectionOf(() => {
      return moveDevPort({
        cwd: dir,
        devPort: 3101,
        source: CLOUD,
        orca: createOrca(),
        cliVersion: "0.0.0",
        dryRun: false,
        signal: new AbortController().signal,
        consent: () => {
          return Promise.reject(new Error("a bug in the caller"));
        },
      });
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ message: "a bug in the caller" });
  });
});
