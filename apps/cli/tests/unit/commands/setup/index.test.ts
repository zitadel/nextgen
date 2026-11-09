import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { parseEnv } from "node:util";

import { beforeEach, describe, expect } from "vitest";

import Setup, {
  buildSummary,
  readCredentialEnvFiles,
  refuseUnusableFlags,
  restoreCredentialEnvFiles,
  type SetupFlagsToCheck,
} from "@/commands/setup";
import { ZitadelError } from "@/lib/errors";
import {
  localRuntimePaths,
  type RuntimeMetadata,
  writeRuntimeMetadata,
} from "@/lib/local-server/runtime";
import { LocalServer } from "@/lib/local-server/server";
import { type SuggestedCommand, unscopedCommand } from "@/lib/suggestion";
import { takeReportedWarnings } from "@/lib/warnings";
import { it, type Serve } from "@tests/helpers/fixtures";
import { write } from "@tests/helpers/git-repo";
import { parseFlag } from "@tests/helpers/inputs";
import { expectedPublicCliCommand, parseJson, runCliForTest } from "@tests/helpers/run-cli";
import { aBinaryRecord } from "@tests/helpers/runtime-record";
import { aNextApp, suggestedCommands } from "@tests/helpers/setup";
import { rejectionOf, thrownBy } from "@tests/helpers/thrown-value";

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
      ".zitadel/schemas/default-human-user.json": "{}\n",
    },
    named: "default-human-user.json",
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
function aHealthyServer(serve: Serve): Promise<string> {
  return serve((req, res) => {
    if (req.url === "/readyz") {
      res.writeHead(200).end("ok");
      return;
    }
    res.writeHead(404).end();
  });
}

/**
 * A server that answers every request 404, as a server with no project
 * endpoint does.
 *
 * @param serve - The fixture that starts the server.
 * @returns Its base URL.
 */
function aServerWithoutEndpoints(serve: Serve): Promise<string> {
  return serve((_req, res) => {
    res
      .writeHead(404, { "content-type": "application/json" })
      .end(JSON.stringify({ message: "not found" }));
  });
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

  describe("when its first deploy fails", () => {
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

  describe("with a renderer that is declared but not published", () => {
    it("refuses with E_VALIDATION while parsing its flags, before any project is created", async ({
      dir,
    }) => {
      const res = await runCliForTest(setupIn(dir, "--renderer", "web-component", ...SCRIPTED));

      expect(res).toFailWith("E_VALIDATION");
      expect(res).toExplain("web-component");
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
