import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { parseEnv } from "node:util";

import { DEFAULT_SETUP_PRESET, DEFAULT_SETUP_USE_CASE } from "@zitadel/config/defaults";
import { HttpResponse, http, passthrough } from "msw";
import { beforeEach, describe, expect, vi } from "vitest";

vi.mock("@clack/prompts", async () => {
  return (await import("@tests/helpers/clack")).clackDouble();
});

vi.mock("@/commands/setup/prompts", async (importOriginal) => {
  return { ...(await importOriginal<object>()), askCustomSettings: vi.fn() };
});

vi.mock("@/lib/scaffold-manifest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scaffold-manifest")>();
  return { ...actual, writeScaffoldManifest: vi.fn(actual.writeScaffoldManifest) };
});

import { confirm, intro, isCancel, log, multiselect, outro, select } from "@clack/prompts";

import Setup, {
  buildSummary,
  localServerHostsPlatform,
  portInUseWarning,
  readCredentialEnvFiles,
  refuseUnusableFlags,
  restoreCredentialEnvFiles,
  retryOptionsFromFlags,
  type SetupFlagsToCheck,
  setupRetryFlags,
  ssoFromFlags,
} from "@/commands/setup";
import { askCustomSettings } from "@/commands/setup/prompts";
import { createZitadelClient } from "@/lib/backend";
import { ZitadelError } from "@/lib/errors";
import { customExample, SETUP_FLAG_NAMES } from "@/lib/idp";
import { asker } from "@/lib/input";
import {
  localRuntimePaths,
  type RuntimeMetadata,
  writeRuntimeMetadata,
} from "@/lib/local-server/runtime";
import { LocalServer } from "@/lib/local-server/server";
import { readZitadelSecret } from "@/lib/project";
import { writeScaffoldManifest } from "@/lib/scaffold-manifest";
import { type SuggestedCommand, unscopedCommand } from "@/lib/suggestion";
import { takeReportedWarnings } from "@/lib/warnings";
import { aFakeAppGeneratorPath } from "@tests/helpers/app-generator";
import { aUserSchema } from "@tests/helpers/config";
import { it, type Serve } from "@tests/helpers/fixtures";
import { write } from "@tests/helpers/git-repo";
import { parseFlag } from "@tests/helpers/inputs";
import { usePlatformServer } from "@tests/helpers/platform-project";
import {
  expectedPublicCliCommand,
  parseJson,
  runCliForTest,
  stripAnsi,
} from "@tests/helpers/run-cli";
import { aBinaryRecord, aDockerRecord } from "@tests/helpers/runtime-record";
import { aNextApp, suggestedCommands } from "@tests/helpers/setup";
import { asTerminal } from "@tests/helpers/terminal";
import { rejectionOf, thrownBy } from "@tests/helpers/thrown-value";

const { server } = usePlatformServer();

/**
 * How a script runs setup: no prompt, and one JSON envelope on stdout.
 */
const SCRIPTED = ["--non-interactive", "--json"];

/**
 * Points setup at the local server `zitadel start` recorded.
 */
const LOCAL = ["--server", "local"];

/**
 * `--dev-port` for a run that checks every warning: setup warns when the
 * app's port is taken, and whatever holds 3000 on the machine running the
 * tests must not decide what it reports.
 */
const PINNED_DEV_PORT = ["--dev-port", "3000"];

/**
 * The version of the server this CLI ships.
 */
const BUNDLED_VERSION = String(LocalServer.bundledVersion());

/**
 * A server URL nothing answers on, for a runtime record of a server that is
 * not running.
 */
const DOWN_SERVER_URL = "http://localhost:9";

/**
 * A Google client id of the shape Google issues.
 */
const GOOGLE_CLIENT_ID = "1234-abc.apps.googleusercontent.com";

/**
 * A client id that a shell would split and run part of. The wizard accepts
 * any non-empty client id, and suggested commands are run verbatim, so no id
 * is ever put into command text: the rerun asks for it instead.
 */
const SHELL_HOSTILE_CLIENT_ID = "id with spaces; echo pwned";

/**
 * The `package.json` of a Next.js app.
 */
const NEXT_PACKAGE = JSON.stringify({ name: "demo", dependencies: { next: "^16" } });

/**
 * The root component of an existing Vite React app, which setup would write.
 */
const OWN_APP = "export default function App() {\n  return <h1>Mine</h1>;\n}\n";

/**
 * The flags a person names every framework setup scaffolds with.
 */
const FRAMEWORKS = ["next", "nuxt", "react", "vue", "angular"];

/**
 * An existing Vite React app whose root component setup would overwrite.
 */
const VITE_REACT_APP = {
  "package.json": JSON.stringify({ name: "demo", dependencies: { react: "^19", vite: "^7" } }),
  "vite.config.ts": 'import { defineConfig } from "vite";\n\nexport default defineConfig({});\n',
  "src/App.tsx": OWN_APP,
};

/**
 * Conflicts the file-writer cannot see, because the file is at another path
 * (a root component, a request boundary), or that only showed once the
 * project existed (the files setup writes after creating it).
 */
const PRE_PROJECT_CONFLICTS: ReadonlyArray<{
  conflict: string;
  files: Record<string, string>;
  named: string;
}> = [
  {
    conflict: "a root component at another path",
    files: {
      "package.json": JSON.stringify({ name: "demo", dependencies: { react: "^19", vite: "^7" } }),
      "vite.config.js":
        'import { defineConfig } from "vite";\n\nexport default defineConfig({});\n',
      "index.html": '<script type="module" src="/src/main.jsx"></script>\n',
      "src/main.jsx":
        'import { createRoot } from "react-dom/client";\nimport App from "./App.jsx";\n\n' +
        'createRoot(document.getElementById("root")).render(<App />);\n',
      "src/App.jsx": OWN_APP,
    },
    named: "src/App.jsx",
  },
  {
    conflict: "a request boundary under the other name",
    files: {
      "package.json": NEXT_PACKAGE,
      "app/layout.tsx": "export default function Layout() {}\n",
      "middleware.ts": "export function middleware() {}\n",
    },
    named: "middleware.ts",
  },
  {
    conflict: "a default schema setup would overwrite",
    files: {
      "package.json": NEXT_PACKAGE,
      "app/layout.tsx": "export default function Layout() {}\n",
      ".zitadel/schemas/default-human-user.json": `${JSON.stringify(aUserSchema())}\n`,
    },
    named: "default-human-user.json",
  },
];

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
 * A scripted move of an app already set up to port 3101.
 */
const MOVE_TO_3101 = ["--non-interactive", "--dev-port", "3101"];

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
const ask = asker({ interactive: true, force: false });

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
 * A project the capturing platform created.
 */
type CreatedOnPlatform = { id: string; project_secret: string };

/**
 * A deployment the capturing platform was asked for, and the token it carried.
 */
type RequestedDeployment = { body: unknown; authorization: string | undefined };

/**
 * What a capturing platform recorded, and how to make it fail.
 */
type CapturingPlatform = {
  /** Its base URL. */
  readonly url: string;
  /** Every request, as `METHOD /path`, in order. */
  readonly requests: string[];
  /** The body of every `POST /projects`, in order. */
  readonly createBodies: unknown[];
  /** Every project created, in order. */
  readonly projects: CreatedOnPlatform[];
  /** Every `POST /deployments`, in order. */
  readonly deployments: RequestedDeployment[];
  /** Makes `POST /releases/build` fail, so setup's first deploy fails. */
  rejectsReleases(): void;
};

/**
 * What a capturing platform does beyond answering.
 */
type CapturingOptions = {
  /**
   * Runs before `POST /projects` is answered: after setup's dry-run patch,
   * before its real one. It is told how many projects exist already.
   */
  onCreateProject?: (created: number) => Promise<void>;
};

/**
 * Lets requests to `url` reach the server listening there. The mock
 * platform's routes match any origin, so they would otherwise answer for it,
 * and a request they do not know would fail as unhandled.
 *
 * @param url - The server's base URL.
 */
function passingThrough(url: string): void {
  server.use(
    http.all(`${url}/*`, () => {
      return passthrough();
    }),
  );
}

/**
 * Reads a request's JSON body.
 *
 * @param req - The request.
 * @returns The parsed body.
 */
async function bodyOf(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * The release a deployment request names.
 *
 * @param body - The request's body.
 * @returns Its `release_id`, or `undefined` when it names none.
 */
function releaseIdOf(body: unknown): unknown {
  if (typeof body === "object" && body !== null && "release_id" in body) {
    return body.release_id;
  }
  return undefined;
}

/**
 * The few platform routes a scripted setup calls, answered on a real port and
 * recorded. Setup's pre-flight branches and what a setup that fails partway
 * leaves on disk need no more than these, so these tests run against it
 * rather than the api-mock.
 *
 * @param serve - The fixture that starts the server.
 * @param options - What it does beyond answering.
 * @returns The platform.
 */
async function aCapturingPlatform(
  serve: Serve,
  options: CapturingOptions = {},
): Promise<CapturingPlatform> {
  const requests: string[] = [];
  const createBodies: unknown[] = [];
  const projects: CreatedOnPlatform[] = [];
  const deployments: RequestedDeployment[] = [];
  const failing = { releases: false };
  const url = await serve(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    requests.push(`${req.method ?? "GET"} ${path}`);
    if (req.method === "POST" && path === "/api/v1/projects") {
      createBodies.push(await bodyOf(req));
      await options.onCreateProject?.(projects.length);
      const n = String(projects.length + 1);
      const project = { id: `proj_test_${n}`, project_secret: `sk_proj_test_${n}_full` };
      projects.push(project);
      res.writeHead(201, { "content-type": "application/json" }).end(
        JSON.stringify({
          ...project,
          name: "demo",
          preview_secret: "sk_proj_test_preview",
          origins: [],
          created_at: "2026-06-01T00:00:00.000Z",
        }),
      );
      return;
    }
    if (req.method === "POST" && path === "/api/v1/releases/build") {
      if (failing.releases) {
        res
          .writeHead(500, { "content-type": "application/json" })
          .end(JSON.stringify({ code: "internal", message: "boom" }));
        return;
      }
      res.writeHead(201, { "content-type": "application/json" }).end(
        JSON.stringify({
          id: "rel_test",
          content_hash: "sha256:test",
          created_at: "2026-06-01T00:00:00.000Z",
        }),
      );
      return;
    }
    if (req.method === "POST" && path === "/api/v1/deployments") {
      const body = await bodyOf(req);
      deployments.push({ body, authorization: req.headers.authorization });
      res.writeHead(201, { "content-type": "application/json" }).end(
        JSON.stringify({
          id: "dep_test",
          release_id: releaseIdOf(body),
          targets: [{ origin: "http://localhost:3000" }],
          deployed_at: "2026-06-01T00:00:00.000Z",
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  passingThrough(url);
  return {
    url,
    requests,
    createBodies,
    projects,
    deployments,
    rejectsReleases() {
      failing.releases = true;
    },
  };
}

/**
 * A server that answers only the health probe, as a running local server does.
 *
 * @param serve - The fixture that starts the server.
 * @returns Its base URL.
 */
async function aHealthyServer(serve: Serve): Promise<string> {
  const url = await serve((req, res) => {
    if (req.url === "/readyz") {
      res.writeHead(200).end("ok");
      return;
    }
    res.writeHead(404).end();
  });
  passingThrough(url);
  return url;
}

/**
 * A server that answers every request 404, as a server with no project
 * endpoint does.
 *
 * @param serve - The fixture that starts the server.
 * @returns Its base URL.
 */
async function aServerWithoutEndpoints(serve: Serve): Promise<string> {
  const url = await serve((_req, res) => {
    res
      .writeHead(404, { "content-type": "application/json" })
      .end(JSON.stringify({ message: "not found" }));
  });
  passingThrough(url);
  return url;
}

/**
 * A binary runtime as `start` records it in `cwd`: this process, running
 * `serverVersion` at `serverUrl`.
 *
 * @param cwd - The directory `start` ran in.
 * @param serverUrl - The server's base URL.
 * @param serverVersion - The version it runs.
 * @returns The record.
 */
function aRuntime(
  cwd: string,
  serverUrl: string,
  serverVersion = BUNDLED_VERSION,
): RuntimeMetadata {
  return aBinaryRecord({
    pid: process.pid,
    command: process.execPath,
    log_path: localRuntimePaths(cwd).logFile,
    server_version: serverVersion,
    port: Number(new URL(serverUrl).port),
    server_url: serverUrl,
    data_dir: localRuntimePaths(cwd).dataDir,
    cli_version: serverVersion,
  });
}

/**
 * `setup` in `cwd`, with `flags`.
 *
 * @param cwd - The directory to set up.
 * @param flags - The flags to pass.
 * @returns The command line.
 */
function setupIn(cwd: string, ...flags: string[]): string[] {
  return ["setup", "--cwd", cwd, ...flags];
}

/**
 * A scripted `setup` of `cwd` against `server`, skipping the install.
 *
 * @param cwd - The directory to set up.
 * @param server - The server to set it up against.
 * @param flags - Further flags to pass.
 * @returns The command line.
 */
function scriptedAgainst(cwd: string, server: string, ...flags: string[]): string[] {
  return setupIn(cwd, "--server", server, ...SCRIPTED, "--skip-install", ...flags);
}

/**
 * Puts a file where setup writes its `.zitadel/policies` directory, so writing
 * its configuration fails once the project exists.
 *
 * @param cwd - The app's directory.
 * @returns Once the file is written.
 */
async function blockThePolicies(cwd: string): Promise<void> {
  await write(cwd, { ".zitadel/policies": "" });
}

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
 * `setup` in `cwd` against `serverUrl`, with one JSON envelope on stdout.
 *
 * @param cwd - The directory to set up.
 * @param serverUrl - The server to set it up against.
 * @param flags - Further flags to pass.
 * @returns The command line.
 */
function against(cwd: string, serverUrl: string, ...flags: string[]): string[] {
  return ["setup", "--cwd", cwd, "--json", "--server", serverUrl, ...flags];
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
 * Answers `serverUrl`'s runtime document as a local server hosting its own
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
 * Makes the local admin's claim on `serverUrl` fail before it starts.
 *
 * @param serverUrl - The local server.
 * @returns The handler.
 */
function failingTheClaim(serverUrl: string) {
  return http.post(`${serverUrl}/api/v1/projects/:projectId/claim/init`, () => {
    return HttpResponse.json({ code: "internal", message: "claim unavailable" }, { status: 500 });
  });
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
 * Makes the platform answer that nothing is deployed to the project.
 *
 * @returns The handler.
 */
function deployingNothing() {
  return http.get("*/deployments", () => {
    return HttpResponse.json({ deployments: [] });
  });
}

/**
 * Makes the platform refuse to add an origin, as a server that is down does.
 *
 * @returns The handler.
 */
function refusingOrigins() {
  return http.post("*/projects/:project_id/origins", () => {
    return HttpResponse.json({ code: "unavailable", message: "down" }, { status: 503 });
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

/**
 * Everything drawn in the chain, as one string.
 *
 * @returns The lines, one to a row.
 */
function drawnLines(): string {
  return vi
    .mocked(log.message)
    .mock.calls.map(([text]) => {
      return String(text);
    })
    .join("\n");
}

/**
 * What a framed report says, a line at a time, with the frame taken off. The
 * frame is coloured, so its glyphs leave escapes behind: strip those too or a
 * border becomes a line of invisible characters rather than nothing.
 *
 * @param output - What the run printed.
 * @returns The lines of the report, without the frame or blank lines.
 */
function framed(output: string): string[] {
  return stripAnsi(output)
    .split("\n")
    .map((line) => {
      return line.replaceAll(/[│╭╮╰╯─]/g, "").trim();
    })
    .filter((line) => {
      return line !== "";
    });
}

describe("setup", () => {
  describe("with zitadel.json already present", () => {
    it("reports itself skipped, as already initialized", async ({ dir }) => {
      await write(dir, { "zitadel.json": JSON.stringify({ project: "proj_x" }) });

      const res = await runCliForTest(setupIn(dir, ...SCRIPTED));

      expect(res).toBeSkipped();
      expect(parseJson(res.stdout)).toMatchObject({ reason: "already-initialized" });
    });
  });

  describe("with .zitadel/secret but no zitadel.json", () => {
    it("refuses with E_CONFLICT", async ({ dir }) => {
      await write(dir, { ".zitadel/secret": JSON.stringify({ project_id: "proj_x" }) });

      const res = await runCliForTest(setupIn(dir, ...SCRIPTED));

      expect(res).toFailWith("E_CONFLICT");
    });
  });

  describe("in an empty directory without --framework", () => {
    it("refuses, hinting at --framework", async ({ dir }) => {
      const res = await runCliForTest(setupIn(dir, ...SCRIPTED));

      expect(res).toFailWith("E_FRAMEWORK_NOT_DETECTED");
      expect(res).toHintAt("--framework");
    });

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

  describe("in a directory holding only what start left", () => {
    it("refuses, hinting at --framework rather than --force", async ({ dir, serve }) => {
      await writeRuntimeMetadata(dir, aRuntime(dir, await aHealthyServer(serve)));

      const res = await runCliForTest(setupIn(dir, ...LOCAL, ...SCRIPTED));

      expect(res).toFailWith("E_FRAMEWORK_NOT_DETECTED");
      expect(res).toHintAt("--framework");
    });

    it("does not hint at --force, since the directory is fresh for a scaffold", async ({
      dir,
      serve,
    }) => {
      await writeRuntimeMetadata(dir, aRuntime(dir, await aHealthyServer(serve)));

      const res = await runCliForTest(setupIn(dir, ...LOCAL, ...SCRIPTED));

      expect(res).not.toHintAt("--force");
    });

    describe("when nobody is at a terminal to choose a framework", () => {
      it("exits 3", async ({ dir, serve }) => {
        await writeRuntimeMetadata(dir, aRuntime(dir, await aHealthyServer(serve)));

        const res = await runCliForTest(setupIn(dir, ...LOCAL));

        expect(res).toExitWith(3);
      });

      it.for([
        "only in a terminal",
        ...FRAMEWORKS,
        expectedPublicCliCommand("setup --framework next --server local"),
      ])("says %s", async (said, { dir, serve }) => {
        await writeRuntimeMetadata(dir, aRuntime(dir, await aHealthyServer(serve)));

        const res = await runCliForTest(setupIn(dir, ...LOCAL));

        expect(res.stderr).toContain(said);
      });

      it("does not say to run without --json or --non-interactive", async ({ dir, serve }) => {
        await writeRuntimeMetadata(dir, aRuntime(dir, await aHealthyServer(serve)));

        const res = await runCliForTest(setupIn(dir, ...LOCAL));

        expect(res.stderr).not.toContain("Run without --json/--non-interactive");
      });
    });
  });

  describe("with a local server another CLI release started", () => {
    it("refuses, naming both versions and how to restart the server", async ({ dir, serve }) => {
      const serverUrl = await aHealthyServer(serve);
      await writeRuntimeMetadata(dir, aRuntime(dir, serverUrl, "0.0.1"));

      const res = await runCliForTest(setupIn(dir, "--framework", "next", ...LOCAL, ...SCRIPTED));

      expect(res).toFailWith("E_CONFLICT");
      expect(parseJson(res.stdout)).toMatchObject({
        message: `The local Zitadel server runs 0.0.1, but this CLI ships ${BUNDLED_VERSION}`,
        hint: expect.stringContaining("Run start to restart it"),
        next_commands: [
          expectedPublicCliCommand(`start --cwd ${dir}`),
          expectedPublicCliCommand(
            `setup --framework next --non-interactive --server local --cwd ${dir}`,
          ),
        ],
        details: { server_url: serverUrl, server_version: "0.0.1" },
      });
    });

    it("writes nothing beside what start left", async ({ dir, serve }) => {
      await writeRuntimeMetadata(dir, aRuntime(dir, await aHealthyServer(serve), "0.0.1"));

      await runCliForTest(setupIn(dir, "--framework", "next", ...LOCAL, ...SCRIPTED));

      expect(await readdir(dir)).toEqual([".zitadel"]);
    });
  });

  describe("with a local server of this CLI's own version", () => {
    it("gets past the version check to ask for --framework", async ({ dir, serve }) => {
      await writeRuntimeMetadata(dir, aRuntime(dir, await aHealthyServer(serve)));

      const res = await runCliForTest(setupIn(dir, ...LOCAL, ...SCRIPTED));

      expect(res).toFailWith("E_FRAMEWORK_NOT_DETECTED");
    });
  });

  describe("when the local server is not running", () => {
    beforeEach(() => {
      passingThrough(DOWN_SERVER_URL);
    });

    it("refuses, keeping the framework in the setup it suggests after start", async ({ dir }) => {
      await writeRuntimeMetadata(dir, aRuntime(dir, DOWN_SERVER_URL));

      const res = await runCliForTest(setupIn(dir, "--framework", "next", ...LOCAL, ...SCRIPTED));

      expect(res).toFailWith("E_LOCAL_SERVER_NOT_RUNNING");
      expect(parseJson(res.stdout)).toMatchObject({
        hint: expect.stringContaining("Start local Zitadel first"),
        next_commands: [
          expectedPublicCliCommand(`start --cwd ${dir}`),
          expectedPublicCliCommand(
            `setup --framework next --non-interactive --server local --cwd ${dir}`,
          ),
        ],
      });
    });

    it("points every recovery command at the project directory", async ({ dir }) => {
      await aNextApp(dir);
      await writeRuntimeMetadata(dir, aRuntime(dir, DOWN_SERVER_URL));

      const res = await runCliForTest(setupIn(dir, "--framework", "next", ...LOCAL, "--json"));

      expect(parseJson(res.stdout)).toMatchObject({
        next_commands: [
          expect.stringContaining(`--cwd ${dir}`),
          expect.stringContaining(`--cwd ${dir}`),
        ],
      });
    });

    describe("with --sso google and a client id, run non-interactively", () => {
      const flags = ["--framework", "next", ...LOCAL, "--sso", "google"];

      it("keeps the provider in the setup it suggests", async ({ dir }) => {
        await aNextApp(dir);
        await writeRuntimeMetadata(dir, aRuntime(dir, DOWN_SERVER_URL));

        const res = await runCliForTest(
          setupIn(dir, ...flags, "--sso-client-id", GOOGLE_CLIENT_ID, ...SCRIPTED),
        );

        expect(res).toSuggest("--sso google");
      });

      it("drops --non-interactive from what it suggests, since the rerun reads the secret from no stdin", async ({
        dir,
      }) => {
        await aNextApp(dir);
        await writeRuntimeMetadata(dir, aRuntime(dir, DOWN_SERVER_URL));

        const res = await runCliForTest(
          setupIn(dir, ...flags, "--sso-client-id", GOOGLE_CLIENT_ID, ...SCRIPTED),
        );

        expect(res).not.toSuggest("--non-interactive");
      });

      it.for(["asks for the client id and secret", "--sso-client-id"])(
        "hints %s, so the scripted path stays reachable",
        async (hinted, { dir }) => {
          await aNextApp(dir);
          await writeRuntimeMetadata(dir, aRuntime(dir, DOWN_SERVER_URL));

          const res = await runCliForTest(
            setupIn(dir, ...flags, "--sso-client-id", GOOGLE_CLIENT_ID, ...SCRIPTED),
          );

          expect(res).toHintAt(hinted);
        },
      );
    });

    describe("with --sso google and a client id, run with --json alone", () => {
      const flags = ["--framework", "next", ...LOCAL, "--sso", "google", "--sso-client-id", "abc"];

      it("keeps the provider in the setup it suggests, though the client id is left out", async ({
        dir,
      }) => {
        await aNextApp(dir);
        await writeRuntimeMetadata(dir, aRuntime(dir, DOWN_SERVER_URL));

        const res = await runCliForTest(setupIn(dir, ...flags, "--json"));

        expect(res).toSuggest("--sso google");
      });

      it("hints at --sso-client-id, which a scripted rerun cannot do without", async ({ dir }) => {
        await aNextApp(dir);
        await writeRuntimeMetadata(dir, aRuntime(dir, DOWN_SERVER_URL));

        const res = await runCliForTest(setupIn(dir, ...flags, "--json"));

        expect(res).toHintAt("--sso-client-id");
      });
    });

    describe("with a client id a shell would split", () => {
      const flags = ["--framework", "next", ...LOCAL, "--sso", "google"];

      it.for(["id with spaces", "echo pwned", "--sso-client-id"])(
        "suggests no command holding %s",
        async (held, { dir }) => {
          await aNextApp(dir);
          await writeRuntimeMetadata(dir, aRuntime(dir, DOWN_SERVER_URL));

          const res = await runCliForTest(
            setupIn(dir, ...flags, "--sso-client-id", SHELL_HOSTILE_CLIENT_ID, ...SCRIPTED),
          );

          expect(res).not.toSuggest(held);
        },
      );

      it("keeps the client id out of the hint", async ({ dir }) => {
        await aNextApp(dir);
        await writeRuntimeMetadata(dir, aRuntime(dir, DOWN_SERVER_URL));

        const res = await runCliForTest(
          setupIn(dir, ...flags, "--sso-client-id", SHELL_HOSTILE_CLIENT_ID, ...SCRIPTED),
        );

        expect(res).not.toHintAt("echo pwned");
      });

      it("still keeps the provider in the setup it suggests", async ({ dir }) => {
        await aNextApp(dir);
        await writeRuntimeMetadata(dir, aRuntime(dir, DOWN_SERVER_URL));

        const res = await runCliForTest(
          setupIn(dir, ...flags, "--sso-client-id", SHELL_HOSTILE_CLIENT_ID, ...SCRIPTED),
        );

        expect(res).toSuggest("--sso google");
      });
    });
  });

  describe("in a non-empty directory of no framework it can infer", () => {
    it("refuses, saying the directory is not empty and listing what it holds", async ({ dir }) => {
      await write(dir, { "README.md": "Not a Next.js project." });

      const res = await runCliForTest(setupIn(dir, "--framework", "next", ...SCRIPTED));

      expect(res).toFailWith("E_FRAMEWORK_NOT_DETECTED");
      expect(parseJson(res.stdout)).toMatchObject({
        message: expect.stringContaining("is not empty"),
        details: { entries: expect.arrayContaining(["README.md"]) },
      });
    });

    it.for(["README.md", "--force"])("hints at %s", async (hinted, { dir }) => {
      await write(dir, { "README.md": "Not a Next.js project." });

      const res = await runCliForTest(setupIn(dir, "--framework", "next", ...SCRIPTED));

      expect(res).toHintAt(hinted);
    });
  });

  describe("when the server has no endpoint to create the project", () => {
    it("refuses, pointing at a local rerun that pins the dev port the issuer derives from", async ({
      dir,
      serve,
    }) => {
      await aNextApp(dir);

      const res = await runCliForTest(scriptedAgainst(dir, await aServerWithoutEndpoints(serve)));

      expect(res).toFailWith("E_NOT_FOUND");
      expect(parseJson(res.stdout)).toMatchObject({
        message: expect.stringContaining("has no such endpoint"),
        hint: expect.stringContaining(
          "--framework next --dev-port 3000 --non-interactive --server local",
        ),
        next_commands: [
          expectedPublicCliCommand(`start --cwd ${dir}`),
          expectedPublicCliCommand(
            `setup --framework next --dev-port 3000 --non-interactive --server local --cwd ${dir}`,
          ),
        ],
      });
    });

    it("keeps the sign-in preset in the rerun it points at", async ({ dir, serve }) => {
      await aNextApp(dir);

      const res = await runCliForTest(
        scriptedAgainst(dir, await aServerWithoutEndpoints(serve), "--preset", "passkey-first"),
      );

      expect(parseJson(res.stdout)).toMatchObject({
        hint: expect.stringContaining("--preset passkey-first"),
        next_commands: [
          expectedPublicCliCommand(`start --cwd ${dir}`),
          expectedPublicCliCommand(
            `setup --framework next --preset passkey-first --dev-port 3000 --non-interactive --server local --cwd ${dir}`,
          ),
        ],
      });
    });
  });

  describe("with an app file it would overwrite", () => {
    it("refuses with E_CONFLICT, naming the file", async ({ dir, serve }) => {
      await write(dir, VITE_REACT_APP);
      const platform = await aCapturingPlatform(serve);

      const res = await runCliForTest(scriptedAgainst(dir, platform.url));

      expect(res).toFailWith("E_CONFLICT");
      expect(res).toExplain("App.tsx");
    });

    it("creates no project, so a rerun is not skipped as already set up", async ({
      dir,
      serve,
    }) => {
      await write(dir, VITE_REACT_APP);
      const platform = await aCapturingPlatform(serve);

      await runCliForTest(scriptedAgainst(dir, platform.url));

      expect(platform.requests).not.toContain("POST /api/v1/projects");
    });

    it.for(["zitadel.json", ".zitadel/secret"])("writes no %s", async (path, { dir, serve }) => {
      await write(dir, VITE_REACT_APP);
      const platform = await aCapturingPlatform(serve);

      await runCliForTest(scriptedAgainst(dir, platform.url));

      expect(existsSync(join(dir, path))).toBe(false);
    });

    it("leaves the file as it was", async ({ dir, serve }) => {
      await write(dir, VITE_REACT_APP);
      const platform = await aCapturingPlatform(serve);

      await runCliForTest(scriptedAgainst(dir, platform.url));

      expect(await readFile(join(dir, "src/App.tsx"), "utf8")).toBe(OWN_APP);
    });
  });

  describe("with a conflict the file-writer cannot see", () => {
    it.for(PRE_PROJECT_CONFLICTS)(
      "refuses $conflict with E_CONFLICT, naming it",
      async ({ files, named }, { dir, serve }) => {
        await write(dir, files);
        const platform = await aCapturingPlatform(serve);

        const res = await runCliForTest(scriptedAgainst(dir, platform.url));

        expect(res).toFailWith("E_CONFLICT");
        expect(res).toExplain(named);
      },
    );

    it.for(PRE_PROJECT_CONFLICTS)(
      "creates no project for $conflict",
      async ({ files }, { dir, serve }) => {
        await write(dir, files);
        const platform = await aCapturingPlatform(serve);

        await runCliForTest(scriptedAgainst(dir, platform.url));

        expect(platform.requests).not.toContain("POST /api/v1/projects");
      },
    );

    it.for(PRE_PROJECT_CONFLICTS)(
      "writes no zitadel.json for $conflict",
      async ({ files }, { dir, serve }) => {
        await write(dir, files);
        const platform = await aCapturingPlatform(serve);

        await runCliForTest(scriptedAgainst(dir, platform.url));

        expect(existsSync(join(dir, "zitadel.json"))).toBe(false);
      },
    );
  });

  describe("with a default flow that fails its contract", () => {
    const STUB = '{"steps":"not a flow"}\n';

    it("refuses with E_CONFLICT without --force, naming the file", async ({ dir, serve }) => {
      await aNextApp(dir);
      await write(dir, { ".zitadel/flows/default-login.json": STUB });
      const platform = await aCapturingPlatform(serve);

      const res = await runCliForTest(scriptedAgainst(dir, platform.url));

      expect(res).toFailWith("E_CONFLICT");
      expect(res).toExplain("default-login.json");
    });

    it("replaces it with --force", async ({ dir, serve }) => {
      await aNextApp(dir);
      await write(dir, { ".zitadel/flows/default-login.json": STUB });
      const platform = await aCapturingPlatform(serve);

      await runCliForTest(scriptedAgainst(dir, platform.url, "--force"));

      expect(await readFile(join(dir, ".zitadel/flows/default-login.json"), "utf8")).not.toBe(STUB);
    });
  });

  describe("with a --framework the app is not", () => {
    it("refuses with E_CONFLICT instead of offering --force to scaffold over it", async ({
      dir,
      serve,
    }) => {
      await aNextApp(dir);
      const platform = await aCapturingPlatform(serve);

      const res = await runCliForTest(scriptedAgainst(dir, platform.url, "--framework", "react"));

      expect(res).toFailWith("E_CONFLICT");
      expect(parseJson(res.stdout)).toMatchObject({
        message: "Setup detects Next.js here, not React (Vite)",
        hint: expect.stringContaining("--force or not"),
      });
    });

    it("asks the platform nothing", async ({ dir, serve }) => {
      await aNextApp(dir);
      const platform = await aCapturingPlatform(serve);

      await runCliForTest(scriptedAgainst(dir, platform.url, "--framework", "react"));

      expect(platform.requests).toEqual([]);
    });
  });

  describe("with --dry-run", () => {
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

    it("frames the report under its own headline when nobody is at a terminal", async ({ dir }) => {
      await aNextApp(dir);

      const res = await runCliForTest(
        setupIn(dir, "--server", CLOUD, "--non-interactive", "--skip-install", ...DRY_RUN_NEXT),
      );

      expect(framed(res.stdout)).toContain("Summary");
      expect(res.stdout).not.toContain("Zitadel is ready");
      expect(res.stdout).not.toContain("✓");
      expect(res.stdout).not.toContain("DETECTED");
    });

    it("closes the box with the project and server it ran against", async ({ dir }) => {
      await aNextApp(dir);

      const res = await runCliForTest(
        setupIn(dir, "--server", CLOUD, "--non-interactive", "--skip-install", ...DRY_RUN_NEXT),
      );

      expect(framed(res.stdout).at(-1)).toContain("Using project ");
    });

    it.for([
      { against: "a new cloud project", serverUrl: CLOUD },
      {
        against: "the local server, whose probe a dry run previews optimistically",
        serverUrl: "http://localhost:8080",
      },
    ])("tells $against it is temporary until claimed", async ({ serverUrl }, { dir }) => {
      await aNextApp(dir);

      const res = await runCliForTest(against(dir, serverUrl, ...DRY_RUN_NEXT));

      expect(parseJson(res.stdout)).toMatchObject({
        data: {
          next_actions: expect.arrayContaining([
            expect.stringContaining("temporary and its data may be lost"),
          ]),
        },
      });
    });

    it.for([
      { against: "a new cloud project", serverUrl: CLOUD },
      { against: "the local server", serverUrl: "http://localhost:8080" },
    ])("ends the suggestions for $against with claim", async ({ serverUrl }, { dir }) => {
      await aNextApp(dir);

      const res = await runCliForTest(against(dir, serverUrl, ...DRY_RUN_NEXT));

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

  describe("with a branding file it cannot read", () => {
    it("is not stopped, as it scaffolds no branding", async ({ dir }) => {
      await aNextApp(dir);
      await mkdir(join(dir, ".zitadel/branding/unreadable.json"), { recursive: true });

      const res = await runCliForTest(onTheCloud(dir, ...DRY_RUN_NEXT));

      expect(res).toSucceed();
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

  describe("against a platform that creates the project", () => {
    it("creates it with a name, a primary origin and no server default seeding", async ({
      dir,
      serve,
    }) => {
      await aNextApp(dir);
      const platform = await aCapturingPlatform(serve);

      await runCliForTest(scriptedAgainst(dir, platform.url));

      expect(platform.createBodies).toMatchObject([
        {
          name: expect.stringMatching(/\S/),
          origins: expect.arrayContaining([
            expect.objectContaining({ pattern: expect.any(String), kind: "primary" }),
          ]),
          seed_defaults: false,
        },
      ]);
    });

    it("deploys .zitadel/ to the primary origin with the project secret", async ({
      dir,
      serve,
    }) => {
      await aNextApp(dir);
      const platform = await aCapturingPlatform(serve);

      await runCliForTest(scriptedAgainst(dir, platform.url, "--no-git", ...PINNED_DEV_PORT));

      expect(platform.deployments).toEqual([
        {
          body: expect.objectContaining({ release_id: "rel_test", targets: "primary" }),
          authorization: `Bearer ${platform.projects[0]?.project_secret}`,
        },
      ]);
    });

    it("reports the deployment", async ({ dir, serve }) => {
      await aNextApp(dir);
      const platform = await aCapturingPlatform(serve);

      const res = await runCliForTest(
        scriptedAgainst(dir, platform.url, "--no-git", ...PINNED_DEV_PORT),
      );

      expect(parseJson(res.stdout)).toMatchObject({
        data: {
          deployment: {
            release_id: "rel_test",
            content_hash: "sha256:test",
            deployment_id: "dep_test",
            origins: ["http://localhost:3000"],
          },
        },
      });
    });

    it("succeeds without a warning", async ({ dir, serve }) => {
      await aNextApp(dir);
      const platform = await aCapturingPlatform(serve);

      const res = await runCliForTest(
        scriptedAgainst(dir, platform.url, "--no-git", ...PINNED_DEV_PORT),
      );

      expect(parseJson(res.stdout)).toMatchObject({ status: "ok", warnings: [] });
    });

    it("writes nothing under .zitadel/branding, since the login renders the maintained component", async ({
      dir,
      serve,
    }) => {
      await aNextApp(dir);
      const platform = await aCapturingPlatform(serve);

      await runCliForTest(scriptedAgainst(dir, platform.url, "--no-git", ...PINNED_DEV_PORT));

      expect(existsSync(join(dir, ".zitadel/branding"))).toBe(false);
    });

    it("reports no branding file written", async ({ dir, serve }) => {
      await aNextApp(dir);
      const platform = await aCapturingPlatform(serve);

      const res = await runCliForTest(
        scriptedAgainst(dir, platform.url, "--no-git", ...PINNED_DEV_PORT),
      );

      expect(parseJson(res.stdout)).toMatchObject({
        data: {
          files_written: expect.not.arrayContaining([
            expect.stringContaining(".zitadel/branding/"),
          ]),
        },
      });
    });

    it("publishes no branding revision", async ({ dir, serve }) => {
      await aNextApp(dir);
      const platform = await aCapturingPlatform(serve);

      await runCliForTest(scriptedAgainst(dir, platform.url, "--no-git", ...PINNED_DEV_PORT));

      expect(platform.requests).not.toContain("POST /api/v1/branding");
    });

    it("reports no design", async ({ dir, serve }) => {
      await aNextApp(dir);
      const platform = await aCapturingPlatform(serve);

      const res = await runCliForTest(
        scriptedAgainst(dir, platform.url, "--no-git", ...PINNED_DEV_PORT),
      );

      expect(parseJson(res.stdout)).not.toHaveProperty("data.design");
    });

    it("does not claim a branding revision is live", async ({ dir, serve }) => {
      await aNextApp(dir);
      const platform = await aCapturingPlatform(serve);

      const res = await runCliForTest(
        scriptedAgainst(dir, platform.url, "--no-git", ...PINNED_DEV_PORT),
      );

      expect(parseJson(res.stdout)).toMatchObject({
        data: { next_actions: expect.not.arrayContaining([expect.stringMatching(/revision 1/i)]) },
      });
    });

    it("points at branding eject for the look", async ({ dir, serve }) => {
      await aNextApp(dir);
      const platform = await aCapturingPlatform(serve);

      const res = await runCliForTest(
        scriptedAgainst(dir, platform.url, "--no-git", ...PINNED_DEV_PORT),
      );

      expect(parseJson(res.stdout)).toMatchObject({
        data: { next_actions: expect.arrayContaining([expect.stringContaining("branding eject")]) },
      });
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

  describe("with a local server hosting the platform", () => {
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
        server.use(hostingThePlatform(LOCAL_SERVER), failingTheClaim(LOCAL_SERVER));

        const res = await runCliForTest(against(dir, LOCAL_SERVER, ...SCRIPTED_NEXT));

        expect(res).toSucceed();
      });

      it("keeps the project unclaimed", async ({ dir }) => {
        await aNextApp(dir);
        await aLocalAdmin(dir);
        await recordStartedServer(dir, LOCAL_SERVER);
        server.use(hostingThePlatform(LOCAL_SERVER), failingTheClaim(LOCAL_SERVER));

        await runCliForTest(against(dir, LOCAL_SERVER, ...SCRIPTED_NEXT));

        expect(await readZitadelSecret(dir)).not.toHaveProperty("team_id");
      });

      it("ends its suggestions with claim", async ({ dir }) => {
        await aNextApp(dir);
        await aLocalAdmin(dir);
        await recordStartedServer(dir, LOCAL_SERVER);
        server.use(hostingThePlatform(LOCAL_SERVER), failingTheClaim(LOCAL_SERVER));

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
            return "started this server, run setup from the directory";
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

  describe("against a platform that deploys what setup wrote", () => {
    it("says in the chain that it deployed what it wrote", async ({ dir }) => {
      await aNextApp(dir);

      const res = await runCliForTest(
        setupIn(dir, "--server", CLOUD, ...SCRIPTED_NEXT, "--no-git", ...PINNED_DEV_PORT),
      );

      expect(stripAnsi(res.stdout)).toMatch(/Deployed sha256:[0-9a-f]{12} to 1 origin$/m);
    });

    it("records its first release as 'Initial deployment from setup'", async ({ dir }) => {
      await aNextApp(dir);
      const sent: string[] = [];
      server.use(
        http.post("*/releases/build", async ({ request }) => {
          sent.push(await request.clone().text());
        }),
        http.post("*/deployments", async ({ request }) => {
          sent.push(await request.clone().text());
        }),
      );

      await runCliForTest(
        setupIn(dir, "--server", CLOUD, ...SCRIPTED_NEXT, "--no-git", ...PINNED_DEV_PORT),
      );

      expect(sent.join("\n")).toContain("Initial deployment from setup");
    });
  });

  describe("when its first deploy fails", () => {
    it("names the deploy in the box when its own deploy failed", async ({ dir }) => {
      await aNextApp(dir);
      server.use(
        http.post("*/releases/build", () => {
          return HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 });
        }),
      );

      const res = await runCliForTest(
        setupIn(dir, "--server", CLOUD, ...SCRIPTED_NEXT, "--no-git", ...PINNED_DEV_PORT),
      );

      expect(res).toPrint("Left .zitadel/ undeployed");
      expect(framed(res.stdout).join("\n")).toContain("Deploy .zitadel/ so the project serves");
    });

    it("still succeeds, reporting no deployment", async ({ dir, serve }) => {
      await aNextApp(dir);
      const platform = await aCapturingPlatform(serve);
      platform.rejectsReleases();

      const res = await runCliForTest(
        scriptedAgainst(dir, platform.url, "--no-git", ...PINNED_DEV_PORT),
      );

      expect(res).toSucceed();
      expect(parseJson(res.stdout)).toMatchObject({ data: { deployment: null } });
    });

    it("warns that the project was set up but its first deploy failed", async ({ dir, serve }) => {
      await aNextApp(dir);
      const platform = await aCapturingPlatform(serve);
      platform.rejectsReleases();

      const res = await runCliForTest(
        scriptedAgainst(dir, platform.url, "--no-git", ...PINNED_DEV_PORT),
      );

      expect(parseJson(res.stdout)).toMatchObject({
        warnings: [expect.stringContaining("The project was set up but its first deploy failed")],
      });
    });

    it("suggests the deploy first", async ({ dir, serve }) => {
      await aNextApp(dir);
      const platform = await aCapturingPlatform(serve);
      platform.rejectsReleases();

      const res = await runCliForTest(
        scriptedAgainst(dir, platform.url, "--no-git", ...PINNED_DEV_PORT),
      );

      expect(suggestedCommands(res.stdout)[0]).toContain("deploy -m");
    });

    it("deploys nothing", async ({ dir, serve }) => {
      await aNextApp(dir);
      const platform = await aCapturingPlatform(serve);
      platform.rejectsReleases();

      await runCliForTest(scriptedAgainst(dir, platform.url, "--no-git", ...PINNED_DEV_PORT));

      expect(platform.deployments).toEqual([]);
    });
  });

  describe("when its configuration cannot be written once the project exists", () => {
    it("fails", async ({ dir, serve }) => {
      await aNextApp(dir);
      const platform = await aCapturingPlatform(serve, {
        onCreateProject: () => {
          return blockThePolicies(dir);
        },
      });

      const res = await runCliForTest(scriptedAgainst(dir, platform.url));

      expect(res).toExitWith(3);
    });

    it("removes the .env.local it wrote, which a rerun would only add to", async ({
      dir,
      serve,
    }) => {
      await aNextApp(dir);
      const platform = await aCapturingPlatform(serve, {
        onCreateProject: () => {
          return blockThePolicies(dir);
        },
      });

      await runCliForTest(scriptedAgainst(dir, platform.url));

      expect(existsSync(join(dir, ".env.local"))).toBe(false);
    });

    it("puts back the .env.local the app already had", async ({ dir, serve }) => {
      const own = "# The app's own settings\nDATABASE_URL=postgres://localhost:5432/app";
      await aNextApp(dir);
      await write(dir, { ".env.local": own });
      const platform = await aCapturingPlatform(serve, {
        onCreateProject: () => {
          return blockThePolicies(dir);
        },
      });

      await runCliForTest(scriptedAgainst(dir, platform.url));

      expect(await readFile(join(dir, ".env.local"), "utf8")).toBe(own);
    });

    describe("and is rerun with --force once it can be", () => {
      it("succeeds", async ({ dir, serve }) => {
        await aNextApp(dir);
        const platform = await aCapturingPlatform(serve, {
          onCreateProject: async (created) => {
            if (created === 0) {
              await blockThePolicies(dir);
            }
          },
        });
        await runCliForTest(scriptedAgainst(dir, platform.url));
        await rm(join(dir, ".zitadel/policies"));

        const res = await runCliForTest(scriptedAgainst(dir, platform.url, "--force"));

        expect(res).toSucceed();
      });

      it("points .env.local at the project the rerun created", async ({ dir, serve }) => {
        await aNextApp(dir);
        const platform = await aCapturingPlatform(serve, {
          onCreateProject: async (created) => {
            if (created === 0) {
              await blockThePolicies(dir);
            }
          },
        });
        await runCliForTest(scriptedAgainst(dir, platform.url));
        await rm(join(dir, ".zitadel/policies"));

        await runCliForTest(scriptedAgainst(dir, platform.url, "--force"));

        expect(parseEnv(await readFile(join(dir, ".env.local"), "utf8"))).toMatchObject({
          ZITADEL_PROJECT_ID: platform.projects[1]?.id,
          ZITADEL_PROJECT_SECRET: platform.projects[1]?.project_secret,
          NEXT_PUBLIC_ZITADEL_PROJECT_ID: platform.projects[1]?.id,
        });
      });
    });
  });

  describe("when patching the app fails partway through", () => {
    it("fails", async ({ dir, serve }) => {
      await aNextApp(dir);
      const platform = await aCapturingPlatform(serve, {
        onCreateProject: async () => {
          await mkdir(join(dir, "app/login/page.tsx"), { recursive: true });
        },
      });

      const res = await runCliForTest(scriptedAgainst(dir, platform.url));

      expect(res).toExitWith(3);
    });

    it("removes the .env.local it merged before it reached the failing file", async ({
      dir,
      serve,
    }) => {
      await aNextApp(dir);
      const platform = await aCapturingPlatform(serve, {
        onCreateProject: async () => {
          await mkdir(join(dir, "app/login/page.tsx"), { recursive: true });
        },
      });

      await runCliForTest(scriptedAgainst(dir, platform.url));

      expect(existsSync(join(dir, ".env.local"))).toBe(false);
    });
  });

  describe("when the default configuration of a new app cannot be written", () => {
    it("says the new app is gone again", async ({ dir }) => {
      const cwd = await aNewAppDirectory(dir);
      server.use(
        http.post("*/projects", async () => {
          await blockThePolicies(cwd);
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
          await blockThePolicies(cwd);
        }),
      );

      const res = await runCliForTest(onTheCloud(cwd, ...SCRIPTED_NEXT), {
        PATH: await aFakeAppGeneratorPath(),
      });

      expect(suggestedCommands(res.stdout)).toEqual([]);
    });
  });

  describe("with --design, which it no longer applies", () => {
    it("refuses with E_VALIDATION, pointing at the --zl-* tokens and branding eject", async ({
      dir,
      serve,
    }) => {
      const platform = await aCapturingPlatform(serve);

      const res = await runCliForTest(
        setupIn(dir, "--design", "split", "--server", platform.url, ...SCRIPTED),
      );

      expect(res).toFailWith("E_VALIDATION");
      expect(parseJson(res.stdout)).toMatchObject({
        message: expect.stringContaining("no longer applies a login template"),
        hint: expect.stringContaining("--zl-*"),
        next_commands: [expect.stringContaining("branding eject")],
      });
    });

    it("asks the platform nothing", async ({ dir, serve }) => {
      const platform = await aCapturingPlatform(serve);

      await runCliForTest(setupIn(dir, "--design", "split", "--server", platform.url, ...SCRIPTED));

      expect(platform.requests).toEqual([]);
    });

    it("writes no .zitadel directory", async ({ dir, serve }) => {
      const platform = await aCapturingPlatform(serve);

      await runCliForTest(setupIn(dir, "--design", "split", "--server", platform.url, ...SCRIPTED));

      expect(existsSync(join(dir, ".zitadel"))).toBe(false);
    });
  });

  describe("with --sso google and no client id", () => {
    it("refuses with E_VALIDATION, naming --sso-client-id, before touching the directory", async ({
      dir,
    }) => {
      const res = await runCliForTest(setupIn(dir, ...SCRIPTED, "--sso", "google"));

      expect(res).toFailWith("E_VALIDATION");
      expect(res).toExplain("--sso-client-id");
    });
  });

  describe("with --sso-client-id and no provider", () => {
    it("refuses with E_VALIDATION", async ({ dir }) => {
      const res = await runCliForTest(
        setupIn(dir, ...SCRIPTED, "--sso-client-id", GOOGLE_CLIENT_ID),
      );

      expect(res).toFailWith("E_VALIDATION");
    });
  });

  describe("with a provider the catalog does not know", () => {
    it("refuses", async ({ dir }) => {
      const res = await runCliForTest(
        setupIn(dir, ...SCRIPTED, "--sso", "myspace", "--sso-client-id", "abc"),
      );

      expect(res).toFail();
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

    describe("when run without --json", () => {
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

  describe("with a flag value it cannot use", () => {
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
  });

  describe("with a renderer that is declared but not published", () => {
    it("refuses with E_VALIDATION while parsing its flags, before any project is created", async ({
      dir,
    }) => {
      const res = await runCliForTest(setupIn(dir, "--renderer", "web-component", ...SCRIPTED));

      expect(res).toFailWith("E_VALIDATION");
      expect(res).toExplain("web-component");
    });
  });

  describe("with an app already set up and a --dev-port to move it to", () => {
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
        server.use(deployingNothing());

        const res = await runCliForTest(onTheCloud(dir, ...MOVE_TO_3101, "--force"));

        expect(parseJson(res.stdout)).toMatchObject({
          warnings: expect.arrayContaining([
            expect.stringMatching(
              /^http:\/\/localhost:3101 serves nothing until the next deploy: nothing is deployed to the project yet\. Run \S+ \S+ deploy .+\.$/,
            ),
          ]),
        });
      });

      it("suggests the deploy", async ({ dir }) => {
        await aNextApp(dir, { scripts: { dev: "next dev" } });
        await runCliForTest(onTheCloud(dir, "--non-interactive", "--skip-install"));
        server.use(deployingNothing());

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
              /^http:\/\/localhost:3000 is still among the project's origins; it admits a port nothing serves any more\. Remove it with \S+ \S+ origin rm http:\/\/localhost:3000 --force .+\.$/,
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
        server.use(refusingOrigins());

        const res = await runCliForTest(onTheCloud(dir, ...MOVE_TO_3101));

        expect(res).toFail();
      });

      it.for(["package.json", ".env.local"])("leaves %s as it was", async (path, { dir }) => {
        await aNextApp(dir, { scripts: { dev: "next dev" } });
        await runCliForTest(onTheCloud(dir, "--non-interactive", "--skip-install"));
        const before = await readFile(join(dir, path), "utf8");
        server.use(refusingOrigins());

        await runCliForTest(onTheCloud(dir, ...MOVE_TO_3101));

        expect(await readFile(join(dir, path), "utf8")).toBe(before);
      });
    });
  });
});

describe("setup --help", () => {
  it("succeeds", async () => {
    const res = await runCliForTest(["setup", "--help"]);

    expect(res).toExitWith(0);
  });

  it("does not offer a login design", async () => {
    const res = await runCliForTest(["setup", "--help"]);

    expect(res.stdout).not.toContain("--design");
  });

  it("offers only the renderers that are implemented", async () => {
    const res = await runCliForTest(["setup", "--help"]);

    expect(res.stdout).toContain("<options: react>");
  });

  it("does not offer web-component as a renderer to select", async () => {
    const res = await runCliForTest(["setup", "--help"]);

    expect(res.stdout.replace(/\s+/g, " ")).not.toContain("react|web-component");
  });

  it("says web-component is not yet available", async () => {
    const res = await runCliForTest(["setup", "--help"]);

    expect(res.stdout.replace(/\s+/g, " ")).toContain("Not yet available: web-component.");
  });
});

describe("Setup.run", () => {
  beforeEach(() => {
    vi.spyOn(LocalServer, "isPortFree").mockResolvedValue(true);
  });

  describe("with --force", () => {
    it("still asks whether to proceed with the detected framework", async ({ dir }) => {
      await aNextApp(dir);
      vi.mocked(confirm).mockResolvedValueOnce(false);

      await rejectionOf(() => {
        return asTerminal(() => {
          return Setup.run(["--cwd", dir, "--server", CLOUD, "--force"]);
        });
      });

      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Would you like to set up Zitadel in this Next.js app?",
        }),
      );
    });
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

  describe("with the detected framework accepted and every question answered", () => {
    beforeEach(() => {
      vi.mocked(log.message).mockClear();
      vi.mocked(outro).mockClear();
    });

    /**
     * Accepts the detected framework, then answers every question after it.
     */
    function answeringEveryQuestion(): void {
      vi.mocked(confirm).mockResolvedValueOnce(true);
      vi.mocked(select)
        .mockResolvedValueOnce(DEFAULT_SETUP_USE_CASE)
        .mockResolvedValueOnce(DEFAULT_SETUP_PRESET)
        .mockResolvedValueOnce(15);
      vi.mocked(multiselect).mockResolvedValueOnce([]);
      vi.mocked(confirm).mockResolvedValueOnce(true);
    }

    it("closes the chain on what the run did, not on the box's own title", async ({ dir }) => {
      await aNextApp(dir);
      answeringEveryQuestion();

      await asTerminal(() => {
        return Setup.run(["--cwd", dir, "--server", CLOUD, "--skip-install"]);
      });

      expect(outro).toHaveBeenCalledWith(expect.stringContaining("Set up Zitadel in this app"));
    });

    it("says in the chain that a step it could not finish gave up", async ({ dir }) => {
      await aNextApp(dir);
      answeringEveryQuestion();
      vi.mocked(writeScaffoldManifest).mockRejectedValueOnce(new Error("disk full"));

      await asTerminal(() => {
        return Setup.run(["--cwd", dir, "--server", CLOUD, "--skip-install"]);
      });

      expect(drawnLines()).toContain("Could not record what setup scaffolded");
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
      vi.mocked(confirm).mockResolvedValueOnce(true);
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

    describe("when the default configuration of the new app cannot be written", () => {
      it("says in the chain that the new app is gone again", async ({ dir }) => {
        const cwd = await aNewAppDirectory(dir);
        answeringEveryQuestion();
        vi.mocked(log.message).mockClear();
        server.use(
          http.post("*/projects", async () => {
            await blockThePolicies(cwd);
          }),
        );

        await rejectionOf(() => {
          return asTerminal(() => {
            return Setup.run(["--cwd", cwd, "--server", CLOUD, "--skip-install"]);
          });
        });

        expect(drawnLines()).toContain("Removed the new app");
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

describe("readCredentialEnvFiles", () => {
  it("refuses a file it cannot open rather than reading it as absent, which a rollback would delete", async ({
    dir,
  }) => {
    await mkdir(join(dir, ".env.development.local"));

    const error = await rejectionOf(() => {
      return readCredentialEnvFiles(dir);
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ code: "EISDIR" });
  });
});

describe("restoreCredentialEnvFiles", () => {
  beforeEach(() => {
    takeReportedWarnings();
  });

  it("puts back a file that existed", async ({ dir }) => {
    await write(dir, { ".env.local": "KEEP=1\n" });
    const before = await readCredentialEnvFiles(dir);
    await write(dir, { ".env.local": "KEEP=1\nZITADEL_PROJECT_ID=abandoned\n" });

    await restoreCredentialEnvFiles(dir, before);

    expect(await readFile(join(dir, ".env.local"), "utf8")).toBe("KEEP=1\n");
  });

  it("removes a file setup created", async ({ dir }) => {
    const before = await readCredentialEnvFiles(dir);
    await write(dir, { ".env.development.local": "ZITADEL_PROJECT_ID=abandoned\n" });

    await restoreCredentialEnvFiles(dir, before);

    expect(existsSync(join(dir, ".env.development.local"))).toBe(false);
  });

  describe("with a file it cannot restore", () => {
    it("does not throw", async ({ dir }) => {
      await mkdir(join(dir, ".env.local"));

      const error = await rejectionOf(() => {
        return restoreCredentialEnvFiles(dir, new Map([[".env.local", Buffer.from("KEEP=1\n")]]));
      });

      expect(error).toBeUndefined();
    });

    it("warns that it could not restore it", async ({ dir }) => {
      await mkdir(join(dir, ".env.local"));

      await restoreCredentialEnvFiles(dir, new Map([[".env.local", Buffer.from("KEEP=1\n")]]));

      expect(takeReportedWarnings()).toEqual([
        expect.stringContaining("Could not restore .env.local"),
      ]);
    });
  });
});

describe("buildSummary", () => {
  const SUMMARY_INPUT = {
    projectFacts: { framework: "next", typescript: true, packageManager: "npm" },
    writtenRel: [],
    depsAdded: [],
    project: {
      id: "proj_test",
      name: "demo",
      project_secret: "sk_proj_test",
      preview_secret: "sk_proj_test_preview",
      origins: [],
      created_at: "2026-06-01T00:00:00.000Z",
    },
    server: "http://localhost:8080",
    issuer: "http://localhost:3000",
    scaffoldedFramework: false,
    scaffoldedBesideFiles: false,
    connections: [],
    signIn: {
      starts_with: "password",
      methods: ["password", "passkey"],
      fields: [
        { name: "email", required: true },
        { name: "givenName", required: false },
      ],
      password_min_length: 15,
      providers: [],
    },
  } satisfies Parameters<typeof buildSummary>[0];

  it.each([
    {
      situation: "a scaffold, without claiming the directory was empty",
      scaffoldedBesideFiles: false,
      value: "new project",
    },
    {
      situation: "a scaffold --force put over files the directory already held",
      scaffoldedBesideFiles: true,
      value: "new project over existing files (--force)",
    },
  ])("describes $situation", ({ scaffoldedBesideFiles, value }) => {
    const sections = buildSummary({
      ...SUMMARY_INPUT,
      scaffoldedFramework: true,
      scaffoldedBesideFiles,
    });

    expect(sections).toContainEqual(
      expect.objectContaining({
        title: "Detected",
        rows: expect.arrayContaining([{ label: "Scaffold", value }]),
      }),
    );
  });

  it("has no scaffold row for an app that already existed", () => {
    const sections = buildSummary(SUMMARY_INPUT);

    expect(sections).toContainEqual(
      expect.objectContaining({
        title: "Detected",
        rows: expect.not.arrayContaining([expect.objectContaining({ label: "Scaffold" })]),
      }),
    );
  });

  it("says what sign-in enables and which registration fields are optional", () => {
    const sections = buildSummary(SUMMARY_INPUT);

    expect(sections).toContainEqual({
      title: "Sign-in",
      rows: [
        { label: "Starts with", value: "password" },
        { label: "Methods", value: "password, passkey" },
        { label: "Registration", value: "email, givenName (optional)" },
        { label: "Passwords", value: "at least 15 characters" },
      ],
    });
  });

  it("points at each customizable folder setup wrote, the password policy included", () => {
    const sections = buildSummary({
      ...SUMMARY_INPUT,
      writtenRel: [
        ".zitadel/schemas/default-human-user.json",
        ".zitadel/flows/default-login.json",
        ".zitadel/policies/auth.factor.password.set.json",
      ],
    });

    expect(sections).toContainEqual(
      expect.objectContaining({
        title: "Customize",
        rows: [
          expect.objectContaining({ label: "User schema" }),
          expect.objectContaining({ label: "Login flow" }),
          expect.objectContaining({ label: "Password policy" }),
        ],
      }),
    );
  });
});

describe("Setup.flags", () => {
  it.each([
    { flag: "sso-client-id", value: "  abc123  ", read: "abc123" },
    { flag: "password-min-length", value: "12", read: 12 },
    { flag: "password-min-length", value: "0", read: null },
    { flag: "sso-slug", value: "acme-sso", read: "acme-sso" },
    { flag: "sso-display-name", value: "Acme SSO", read: "Acme SSO" },
    { flag: "sso-issuer", value: "https://sso.acme.example", read: "https://sso.acme.example" },
    { flag: "sso-scopes", value: "openid profile", read: "openid profile" },
  ] as const)("reads --$flag $value as $read", async ({ flag, value, read }) => {
    const parsed = await parseFlag<unknown>(Setup.flags[flag], value, flag);

    expect(parsed).toBe(read);
  });

  it.each([
    { flag: "sso-client-id", situation: "a blank value", value: "  ", refusal: {} },
    {
      flag: "password-min-length",
      situation: "a value the policy would not accept, with the parser's reason",
      value: "many",
      refusal: { message: expect.stringContaining("Must be a whole number from 1 to") },
    },
    { flag: "password-min-length", situation: "a blank value", value: "  ", refusal: {} },
    {
      flag: "sso-slug",
      situation: "a value the provider could not have issued",
      value: "Not A Slug!",
      refusal: { hint: "Fix --sso-slug and run the command again." },
    },
    {
      flag: "sso-slug",
      situation: "a blank value, saying to pass one rather than to fix it",
      value: "  ",
      refusal: {
        message: "the value is empty",
        hint: "Pass a value for --sso-slug, or omit it entirely.",
      },
    },
    {
      flag: "sso-display-name",
      situation: "a value the provider could not have issued",
      value: "x".repeat(257),
      refusal: { hint: "Fix --sso-display-name and run the command again." },
    },
    { flag: "sso-display-name", situation: "a blank value", value: "  ", refusal: {} },
    {
      flag: "sso-issuer",
      situation: "a value the provider could not have issued",
      value: "not a url",
      refusal: { hint: "Fix --sso-issuer and run the command again." },
    },
    { flag: "sso-issuer", situation: "a blank value", value: "  ", refusal: {} },
    {
      flag: "sso-scopes",
      situation: "a value the provider could not have issued",
      value: "   ,  ",
      refusal: { hint: "Fix --sso-scopes and run the command again." },
    },
    { flag: "sso-scopes", situation: "a blank value", value: "  ", refusal: {} },
  ] as const)("--$flag refuses $situation", async ({ flag, value, refusal }) => {
    const error = await rejectionOf(() => {
      return parseFlag<unknown>(Setup.flags[flag], value, flag);
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({ code: "E_VALIDATION", ...refusal });
  });
});

describe("refuseUnusableFlags", () => {
  /**
   * Builds a suggested command the way an unscoped CLI release names it.
   *
   * @param command - The command after the binary.
   * @returns The full command.
   */
  const suggest = (command: string): SuggestedCommand => {
    return unscopedCommand(command, "1.0.0");
  };

  it.each<{ situation: string; flags: SetupFlagsToCheck; scripted: boolean; refusal: object }>([
    {
      situation: "--design whatever it names, pointing at branding eject",
      flags: { design: "centered" },
      scripted: false,
      refusal: {
        code: "E_VALIDATION",
        message: "setup no longer applies a login template, so --design was removed",
        nextCommands: [expect.stringContaining("branding eject")],
      },
    },
    {
      situation: "a client id with no provider, saying how to name one",
      flags: { ssoClientId: "abc" },
      scripted: false,
      refusal: {
        message: "--sso-client-id needs --sso",
        hint: "Name the provider with --sso, e.g. --sso google.",
      },
    },
    {
      situation: "--sso-slug with no provider",
      flags: { ssoSlug: "x" },
      scripted: false,
      refusal: { message: "--sso-slug needs --sso custom" },
    },
    {
      situation: "--sso-display-name with no provider",
      flags: { ssoDisplayName: "x" },
      scripted: false,
      refusal: { message: "--sso-display-name needs --sso custom" },
    },
    {
      situation: "--sso-issuer with no provider",
      flags: { ssoIssuer: "x" },
      scripted: false,
      refusal: { message: "--sso-issuer needs --sso custom" },
    },
    {
      situation: "--sso-scopes with no provider",
      flags: { ssoScopes: "x" },
      scripted: false,
      refusal: { message: "--sso-scopes needs --sso custom" },
    },
    {
      situation: "custom connection settings beside a catalog provider, naming and listing each",
      flags: { sso: "google", ssoIssuer: "https://x", ssoSlug: "x" },
      scripted: false,
      refusal: {
        message: "--sso-slug, --sso-issuer only applies to a custom connection",
        hint: expect.stringContaining("remove them"),
        details: { flags: ["--sso-slug", "--sso-issuer"] },
      },
    },
    {
      situation: "one custom connection setting beside a catalog provider, saying it, not them",
      flags: { sso: "google", ssoIssuer: "https://x" },
      scripted: false,
      refusal: { hint: expect.stringContaining("remove it") },
    },
    {
      situation: "a custom connection a scripted run did not describe, naming what was left out",
      flags: { sso: "custom", ssoSlug: "x", ssoClientId: "abc" },
      scripted: true,
      refusal: {
        message: "A custom connection needs --sso-display-name, --sso-issuer",
        hint: expect.stringContaining("--sso custom --sso-slug"),
        details: { missing: ["--sso-display-name", "--sso-issuer"] },
      },
    },
    {
      situation:
        "a catalog provider a scripted run gave no client id, naming where to register an application",
      flags: { sso: "google" },
      scripted: true,
      refusal: {
        message: "--sso google needs --sso-client-id",
        hint: expect.stringContaining("an OAuth application at https://"),
      },
    },
    {
      situation: "a custom provider a scripted run gave no client id, naming its issuer",
      flags: {
        sso: "custom",
        ssoSlug: "x",
        ssoDisplayName: "X",
        ssoIssuer: "https://sso.acme.example",
      },
      scripted: true,
      refusal: {
        hint: "Register a client at https://sso.acme.example and pass its client id.",
      },
    },
  ])("refuses $situation", ({ flags, scripted, refusal }) => {
    const error = thrownBy(() => {
      return refuseUnusableFlags(flags, scripted, suggest);
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject(refusal);
  });

  it.each<{ situation: string; flags: SetupFlagsToCheck; scripted: boolean }>([
    { situation: "a run without --design", flags: {}, scripted: false },
    {
      situation: "a client id beside a provider",
      flags: { ssoClientId: "abc", sso: "google" },
      scripted: false,
    },
    {
      situation: "a custom connection setting beside the custom provider",
      flags: { ssoSlug: "x", sso: "custom" },
      scripted: false,
    },
    { situation: "a catalog provider on its own", flags: { sso: "google" }, scripted: false },
    {
      situation: "a custom connection a scripted run described",
      flags: {
        sso: "custom",
        ssoSlug: "x",
        ssoDisplayName: "X",
        ssoIssuer: "https://x",
        ssoClientId: "abc",
      },
      scripted: true,
    },
    {
      situation: "a custom connection described in part to a person at a terminal, who is asked",
      flags: { sso: "custom", ssoSlug: "x" },
      scripted: false,
    },
    {
      situation: "a catalog provider a scripted run gave a client id",
      flags: { sso: "google", ssoClientId: "abc" },
      scripted: true,
    },
    {
      situation: "a catalog provider without a client id to a person at a terminal, who is asked",
      flags: { sso: "google" },
      scripted: false,
    },
  ])("accepts $situation", ({ flags, scripted }) => {
    const error = thrownBy(() => {
      return refuseUnusableFlags(flags, scripted, suggest);
    });

    expect(error).toBeUndefined();
  });
});

describe("portInUseWarning", () => {
  describe("when the ports after the taken one are taken too", () => {
    it("names only the flag, since a placeholder would run as a shell redirection", () => {
      const warning = portInUseWarning(3000, undefined, (args) => {
        return unscopedCommand(args, "1.2.3");
      });

      expect(warning).toBe(
        "Port 3000 and the ports after it are already in use. If that is not this app's dev server, run setup with --dev-port and a free port.",
      );
    });
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
