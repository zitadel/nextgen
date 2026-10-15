import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildSummary,
  readCredentialEnvFiles,
  restoreCredentialEnvFiles,
} from "../../../../src/commands/setup/index";
import { takeReportedWarnings } from "../../../../src/lib/warnings";
import { bundledServerVersion } from "../../../../src/lib/local-server/binary";
import {
  localContainerName,
  localRuntimePaths,
  writeRuntimeMetadata,
  type RuntimeMetadata,
} from "../../../../src/lib/local-server/runtime";
import { expectedPublicCliCommand, parseJson, runCliForTest } from "../../../helpers/run-cli";

/**
 * Unit-level guardrails for the `setup` command. The happy path
 * (project create + patch + apply round-trip) is covered by the
 * integration tests in `tests/integration/setup.spec.ts`. The cases
 * here focus on the pre-flight branches that short-circuit before any
 * network or filesystem mutation, and on what a setup that fails
 * partway through leaves on disk, so they run against the small
 * servers below instead of an api-mock.
 */
const tempDirs: string[] = [];
const servers: Server[] = [];

async function makeTempDir(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-test-"));
  tempDirs.push(cwd);
  return cwd;
}

/** Writes `files`, keyed by their path from `cwd`. */
async function writeFiles(cwd: string, files: Record<string, string>): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(cwd, path)), { recursive: true });
    await writeFile(join(cwd, path), contents);
  }
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

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
      "package.json": JSON.stringify({
        name: "demo",
        dependencies: { react: "^19", vite: "^7" },
      }),
      "vite.config.js":
        'import { defineConfig } from "vite";\n\nexport default defineConfig({});\n',
      "index.html": '<script type="module" src="/src/main.jsx"></script>\n',
      "src/main.jsx":
        'import { createRoot } from "react-dom/client";\nimport App from "./App.jsx";\n\n' +
        'createRoot(document.getElementById("root")).render(<App />);\n',
      "src/App.jsx": "export default function App() {\n  return <h1>Mine</h1>;\n}\n",
    },
    named: "src/App.jsx",
  },
  {
    conflict: "a request boundary under the other name",
    files: {
      "package.json": JSON.stringify({ name: "demo", dependencies: { next: "^16" } }),
      "app/layout.tsx": "export default function Layout() {}\n",
      "middleware.ts": "export function middleware() {}\n",
    },
    named: "middleware.ts",
  },
  {
    conflict: "a default schema setup would overwrite",
    files: {
      "package.json": JSON.stringify({ name: "demo", dependencies: { next: "^16" } }),
      "app/layout.tsx": "export default function Layout() {}\n",
      ".zitadel/schemas/default-human-user.json": "{}\n",
    },
    named: "default-human-user.json",
  },
];

describe("setup command pre-flight", () => {
  it("emits status: skipped when zitadel.json already exists", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "zitadel.json"), JSON.stringify({ project: "proj_x" }));

    const res = await runCliForTest(["setup", "--cwd", cwd, "--non-interactive", "--json"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { status: string; reason?: string };
    expect(json.status).toBe("skipped");
    expect(json.reason).toBe("already-initialized");
  });

  it("throws E_CONFLICT when .zitadel/secret exists without zitadel.json", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify({ project_id: "proj_x" }));

    const res = await runCliForTest(["setup", "--cwd", cwd, "--non-interactive", "--json"]);

    expect(res.exitCode).toBe(5);
    const json = parseJson(res.stdout) as { status: string; code: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_CONFLICT");
  });

  it("throws E_FRAMEWORK_NOT_DETECTED for an empty dir when non-interactive without --framework", async () => {
    const cwd = await makeTempDir();

    const res = await runCliForTest(["setup", "--cwd", cwd, "--non-interactive", "--json"]);

    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as { status: string; code: string; hint?: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_FRAMEWORK_NOT_DETECTED");
    expect(json.hint).toContain("--framework");
  });

  it("scaffolds beside the runtime start left: asks for --framework, not --force", async () => {
    const cwd = await makeTempDir();
    const serverUrl = await startHealthServer();
    await writeRuntimeMetadata(cwd, runtimeFor(cwd, serverUrl));

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--server",
      "local",
      "--non-interactive",
      "--json",
    ]);

    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as { status: string; code: string; hint?: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_FRAMEWORK_NOT_DETECTED");
    // `.zitadel/local` from `start` leaves the directory fresh for a scaffold,
    // so a non-interactive run only lacks the framework to scaffold.
    expect(json.hint).toContain("--framework");
    expect(json.hint).not.toContain("--force");
  });

  it("names every framework and the rerun when there is nobody to ask", async () => {
    // What a coding agent meets when it runs the quickstart's `setup --server
    // local` as written: no terminal, so no prompt, and no flag saying so.
    const cwd = await makeTempDir();
    const serverUrl = await startHealthServer();
    await writeRuntimeMetadata(cwd, runtimeFor(cwd, serverUrl));

    const res = await runCliForTest(["setup", "--cwd", cwd, "--server", "local"]);

    expect(res.exitCode).toBe(3);
    expect(res.stderr).toContain("only in a terminal");
    expect(res.stderr).not.toContain("Run without --json/--non-interactive");
    for (const framework of ["next", "nuxt", "react", "vue", "angular"]) {
      expect(res.stderr).toContain(framework);
    }
    expect(res.stderr).toContain(expectedPublicCliCommand("setup --framework next --server local"));
  });

  it("refuses a local server another CLI release started, before writing anything", async () => {
    const cwd = await makeTempDir();
    const serverUrl = await startHealthServer();
    await writeRuntimeMetadata(cwd, binaryRuntimeFor(cwd, serverUrl, "0.0.1"));

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--framework",
      "next",
      "--server",
      "local",
      "--non-interactive",
      "--json",
    ]);

    expect(res.exitCode).toBe(5);
    const json = parseJson(res.stdout) as {
      code: string;
      message: string;
      hint?: string;
      next_commands?: string[];
      details?: Record<string, unknown>;
    };
    expect(json.code).toBe("E_CONFLICT");
    expect(json.message).toBe(
      `The local Zitadel server runs 0.0.1, but this CLI ships ${String(bundledServerVersion())}`,
    );
    expect(json.hint).toContain("Run start to restart it");
    expect(json.next_commands).toEqual([
      expectedPublicCliCommand(`start --cwd ${cwd}`),
      expectedPublicCliCommand(
        `setup --framework next --non-interactive --server local --cwd ${cwd}`,
      ),
    ]);
    expect(json.details).toMatchObject({ server_url: serverUrl, server_version: "0.0.1" });
    // Nothing scaffolded and no project files: only the runtime `start` left.
    expect(await readdir(cwd)).toEqual([".zitadel"]);
  });

  it("goes on against a local server of this CLI's own version", async () => {
    const cwd = await makeTempDir();
    const serverUrl = await startHealthServer();
    const version = bundledServerVersion();
    expect(version).toBeDefined();
    await writeRuntimeMetadata(cwd, binaryRuntimeFor(cwd, serverUrl, String(version)));

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--server",
      "local",
      "--non-interactive",
      "--json",
    ]);

    // Past the version check: what stops it now is the missing --framework.
    expect(parseJson(res.stdout)).toMatchObject({ code: "E_FRAMEWORK_NOT_DETECTED" });
  });

  it("keeps the framework in local-runtime-missing setup guidance", async () => {
    const cwd = await makeTempDir();
    await writeRuntimeMetadata(cwd, runtimeFor(cwd, "http://localhost:9"));

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--framework",
      "next",
      "--server",
      "local",
      "--non-interactive",
      "--json",
    ]);

    expect(res.exitCode).toBe(4);
    const json = parseJson(res.stdout) as {
      status: string;
      code: string;
      hint?: string;
      next_commands?: string[];
    };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_LOCAL_SERVER_NOT_RUNNING");
    expect(json.hint).toContain("Start local Zitadel first");
    expect(json.next_commands).toEqual([
      expectedPublicCliCommand(`start --cwd ${cwd}`),
      expectedPublicCliCommand(
        `setup --framework next --non-interactive --server local --cwd ${cwd}`,
      ),
    ]);
  });

  it("offers an sso retry that can actually be run", async () => {
    // The retry goes into next_commands, which an agent runs verbatim. With
    // --sso and --non-interactive the CLI reads the secret from stdin, and a
    // command handed over as text has none -- so advertising that combination
    // is advertising a command that fails on sight.
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: { next: "^15" } }));
    await writeRuntimeMetadata(cwd, runtimeFor(cwd, "http://localhost:9"));

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--framework",
      "next",
      "--server",
      "local",
      "--sso",
      "google",
      "--sso-client-id",
      "1234-abc.apps.googleusercontent.com",
      "--non-interactive",
      "--json",
    ]);

    const json = parseJson(res.stdout) as { code: string; hint?: string; next_commands?: string[] };
    expect(json.code).toBe("E_LOCAL_SERVER_NOT_RUNNING");
    const retry = (json.next_commands ?? []).find((c) => c.includes("setup "));
    expect(retry).toContain("--sso google");
    expect(retry).not.toContain("--non-interactive");
    // And it says why, so the scripted path is still reachable -- naming both
    // credentials, since the retry carries neither.
    expect(json.hint).toContain("asks for the client id and secret");
    expect(json.hint).toContain("--sso-client-id");
  });

  // Recovery commands configure the project setup was pointed at, not the
  // shell's own directory, so each carries `--cwd`, quoted for a shell.
  it("points every recovery command at the project directory", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: { next: "^15" } }));
    await writeRuntimeMetadata(cwd, runtimeFor(cwd, "http://localhost:9"));

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--framework",
      "next",
      "--server",
      "local",
      "--json",
    ]);

    const json = parseJson(res.stdout) as { next_commands?: string[] };
    expect(json.next_commands?.length).toBeGreaterThan(0);
    for (const command of json.next_commands ?? []) {
      expect(command).toContain(`--cwd ${cwd}`);
    }
  });

  // The suggested retry carries `--sso` without `--sso-client-id`, since the id
  // is never put in command text. Following that retry and hitting the same
  // failure again must not drop the provider from the next suggestion -- the
  // developer would be told to set up without the provider they asked for.
  it("keeps the provider in the retry when only --sso was given", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: { next: "^15" } }));
    await writeRuntimeMetadata(cwd, runtimeFor(cwd, "http://localhost:9"));

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--framework",
      "next",
      "--server",
      "local",
      "--sso",
      "google",
      "--json",
    ]);

    const json = parseJson(res.stdout) as { next_commands?: string[]; hint?: string };
    const retry = (json.next_commands ?? []).find((c) => c.includes("setup "));
    expect(retry).toContain("--sso google");
    // And the scripted route names both flags, because a rerun with --sso and
    // --non-interactive alone fails on the missing client id before stdin is
    // ever read.
    expect(json.hint).toContain("--sso-client-id");
  });

  // Suggested commands are run verbatim, especially by agents, and nothing
  // escapes them for a shell. The wizard accepts any non-empty client id, so a
  // value carrying a space or a metacharacter would split the command or
  // change what it does. No id is interpolated into command text at all --
  // the rerun asks for it, as it already does for the secret.
  it("keeps the client id out of every suggested command", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: { next: "^15" } }));
    await writeRuntimeMetadata(cwd, runtimeFor(cwd, "http://localhost:9"));

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--framework",
      "next",
      "--server",
      "local",
      "--sso",
      "google",
      "--sso-client-id",
      "id with spaces; echo pwned",
      "--non-interactive",
      "--json",
    ]);

    const json = parseJson(res.stdout) as { next_commands?: string[]; hint?: string };
    for (const command of json.next_commands ?? []) {
      expect(command).not.toContain("id with spaces");
      expect(command).not.toContain("echo pwned");
    }
    expect(json.hint ?? "").not.toContain("echo pwned");
    // The provider still reaches the retry; only the id is withheld.
    const retry = (json.next_commands ?? []).find((c) => c.includes("setup "));
    expect(retry).toContain("--sso google");
    expect(retry).not.toContain("--sso-client-id");
  });

  it("explains non-empty dirs whose framework can't be inferred or scaffolded", async () => {
    const cwd = await makeTempDir();
    // A non-empty dir that isn't a known framework — Orca's detector fails
    // and the empty-directory scaffold branch doesn't trigger.
    await writeFile(join(cwd, "README.md"), "Not a Next.js project.");

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--framework",
      "next",
      "--non-interactive",
      "--json",
    ]);

    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      code: string;
      details: { entries: string[]; reason: string };
      hint?: string;
      message: string;
    };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_FRAMEWORK_NOT_DETECTED");
    expect(json.message).toContain("is not empty");
    expect(json.hint).toContain("README.md");
    expect(json.hint).toContain("--force");
    expect(json.details.entries).toContain("README.md");
  });

  it("points cloud project creation failures at the local alpha path", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "app"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "^16" } }),
    );
    const serverUrl = await startNotFoundServer();

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--server",
      serverUrl,
      "--non-interactive",
      "--json",
      "--skip-install",
    ]);

    expect(res.exitCode).toBe(4);
    const json = parseJson(res.stdout) as {
      status: string;
      code: string;
      hint?: string;
      message: string;
      next_commands?: string[];
    };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_NOT_FOUND");
    expect(json.message).toContain("has no such endpoint");
    // The retry pins the resolved dev port: the issuer registered with the
    // project derives from it, so the rerun must reproduce it verbatim.
    expect(json.hint).toContain(
      "--framework next --dev-port 3000 --non-interactive --server local",
    );
    expect(json.next_commands).toEqual([
      expectedPublicCliCommand(`start --cwd ${cwd}`),
      expectedPublicCliCommand(
        `setup --framework next --dev-port 3000 --non-interactive --server local --cwd ${cwd}`,
      ),
    ]);
  });

  it("keeps the sign-in preset in cloud-failure retry guidance", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "app"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "^16" } }),
    );
    const serverUrl = await startNotFoundServer();

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--preset",
      "passkey-first",
      "--server",
      serverUrl,
      "--non-interactive",
      "--json",
      "--skip-install",
    ]);

    expect(res.exitCode).toBe(4);
    const json = parseJson(res.stdout) as {
      status: string;
      code: string;
      hint?: string;
      next_commands?: string[];
    };
    expect(json.status).toBe("error");
    // Following the printed retry verbatim must reproduce the requested
    // sign-in preset, not silently fall back to the default.
    expect(json.hint).toContain("--preset passkey-first");
    expect(json.next_commands).toEqual([
      expectedPublicCliCommand(`start --cwd ${cwd}`),
      expectedPublicCliCommand(
        `setup --framework next --preset passkey-first --dev-port 3000 --non-interactive --server local --cwd ${cwd}`,
      ),
    ]);
  });

  it("sends a project name in create-project payload", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "app"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "^16" } }),
    );
    const capture = await startCreateProjectCaptureServer();

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--server",
      capture.url,
      "--non-interactive",
      "--json",
      "--skip-install",
    ]);

    expect(res.exitCode).toBe(0);
    expect(capture.body).toBeTruthy();
    expect(capture.body).toMatchObject({
      name: expect.any(String),
      origins: expect.arrayContaining([
        expect.objectContaining({ pattern: expect.any(String), kind: "preview" }),
      ]),
      seed_defaults: false,
    });
    const projectName = capture.body?.name;
    expect(typeof projectName).toBe("string");
    if (typeof projectName !== "string") {
      throw new Error("expected create-project payload name to be a string");
    }
    expect(projectName.trim().length).toBeGreaterThan(0);
  });

  it("stops on a file it would overwrite before it creates a project", async () => {
    // An existing Vite React app: setup writes the app's root component, so
    // without --force it must refuse -- and before POST /projects, so nothing
    // is left behind and a rerun is not skipped as already set up.
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { react: "^19", vite: "^7" } }),
    );
    await writeFile(
      join(cwd, "vite.config.ts"),
      'import { defineConfig } from "vite";\n\nexport default defineConfig({});\n',
    );
    await mkdir(join(cwd, "src"), { recursive: true });
    const ownApp = "export default function App() {\n  return <h1>Mine</h1>;\n}\n";
    await writeFile(join(cwd, "src/App.tsx"), ownApp);
    const capture = await startCreateProjectCaptureServer();

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--server",
      capture.url,
      "--non-interactive",
      "--json",
      "--skip-install",
    ]);

    expect(res.exitCode).toBe(5);
    const json = parseJson(res.stdout) as { status: string; code: string; message: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_CONFLICT");
    expect(json.message).toContain("App.tsx");
    expect(capture.requests).not.toContain("POST /projects");
    expect(existsSync(join(cwd, "zitadel.json"))).toBe(false);
    expect(existsSync(join(cwd, ".zitadel/secret"))).toBe(false);
    expect(await readFile(join(cwd, "src/App.tsx"), "utf8")).toBe(ownApp);
  });

  it.each(PRE_PROJECT_CONFLICTS.map((c) => [c.conflict, c] as const))(
    "stops on %s before it creates a project",
    async (_conflict, { files, named }) => {
      const cwd = await makeTempDir();
      await writeFiles(cwd, files);
      const capture = await startCreateProjectCaptureServer();

      const res = await runCliForTest([
        "setup",
        "--cwd",
        cwd,
        "--server",
        capture.url,
        "--non-interactive",
        "--json",
        "--skip-install",
      ]);

      expect(res.exitCode).toBe(5);
      const json = parseJson(res.stdout) as { code: string; message: string };
      expect(json.code).toBe("E_CONFLICT");
      expect(json.message).toContain(named);
      expect(capture.requests).not.toContain("POST /projects");
      expect(existsSync(join(cwd, "zitadel.json"))).toBe(false);
    },
  );

  // Reported as no framework at all, the app would read as a directory to
  // scaffold into, and --force would scaffold a new app over it.
  it("stops on a --framework the app is not, instead of offering --force", async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      "package.json": JSON.stringify({ name: "demo", dependencies: { next: "^16" } }),
      "app/layout.tsx": "export default function Layout() {}\n",
    });
    const capture = await startCreateProjectCaptureServer();

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--framework",
      "react",
      "--server",
      capture.url,
      "--non-interactive",
      "--json",
      "--skip-install",
    ]);

    expect(res.exitCode).toBe(5);
    const json = parseJson(res.stdout) as { code: string; message: string; hint: string };
    expect(json.code).toBe("E_CONFLICT");
    expect(json.message).toBe("Setup detects Next.js here, not React (Vite)");
    expect(json.hint).toContain("--force or not");
    expect(capture.requests).toEqual([]);
  });

  it("writes no login template and publishes no branding revision (#1039)", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "app"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "^16" } }),
    );
    const capture = await startCreateProjectCaptureServer();

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--server",
      capture.url,
      "--non-interactive",
      "--json",
      "--skip-install",
    ]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      warnings: string[];
      data: Record<string, unknown> & { files_written: string[]; next_actions: string[] };
    };
    expect(json.status).toBe("ok");
    expect(json.warnings).toEqual([]);
    // Setup only gets authentication working: the login renders the
    // maintained component, so nothing under .zitadel/branding/ is written
    // and no branding revision is created on the platform.
    expect(existsSync(join(cwd, ".zitadel/branding"))).toBe(false);
    expect(json.data.files_written.some((file) => file.includes(".zitadel/branding/"))).toBe(false);
    expect(capture.requests).not.toContain("POST /branding");
    // The envelope no longer carries a design, and the look guidance must not
    // claim a revision is live.
    expect(json.data).not.toHaveProperty("design");
    const guidance = json.data.next_actions.join("\n");
    expect(guidance).not.toMatch(/revision 1/i);
    expect(guidance).toContain("branding eject");
  });
});

/**
 * A failure once the project exists leaves that project behind, and the patch
 * has already merged its id and secret into `.env.local`. A rerun only adds
 * the keys the file is missing, `--force` or not, so a file left as it is
 * keeps the rerun's app talking to a project with no schema or login flow.
 */
describe("setup that fails after it created the project", () => {
  it("removes the .env.local it wrote when the schema upload fails", async () => {
    const cwd = await makeNextApp();
    const capture = await startCreateProjectCaptureServer();
    capture.rejectsSchemaUploads();

    const res = await runSetup(cwd, capture.url);

    expect(res.exitCode).toBe(4);
    expect(existsSync(join(cwd, ".env.local"))).toBe(false);
  });

  it("puts back the .env.local the app already had when the schema upload fails", async () => {
    const cwd = await makeNextApp();
    const own = "# The app's own settings\nDATABASE_URL=postgres://localhost:5432/app";
    await writeFile(join(cwd, ".env.local"), own);
    const capture = await startCreateProjectCaptureServer();
    capture.rejectsSchemaUploads();

    const res = await runSetup(cwd, capture.url);

    expect(res.exitCode).toBe(4);
    expect(await readFile(join(cwd, ".env.local"), "utf8")).toBe(own);
  });

  it("points the rerun's .env.local at the project the rerun created", async () => {
    const cwd = await makeNextApp();
    const capture = await startCreateProjectCaptureServer();
    capture.rejectsSchemaUploads();
    expect((await runSetup(cwd, capture.url)).exitCode).toBe(4);
    capture.recovers();

    const res = await runSetup(cwd, capture.url, ["--force"]);

    expect(res.exitCode).toBe(0);
    const rerun = capture.projects[1];
    expect(envEntries(await readFile(join(cwd, ".env.local"), "utf8"))).toMatchObject({
      ZITADEL_PROJECT_ID: rerun?.id,
      ZITADEL_PROJECT_SECRET: rerun?.project_secret,
      NEXT_PUBLIC_ZITADEL_PROJECT_ID: rerun?.id,
    });
  });

  it("removes the .env.local it wrote when patching the app fails partway through", async () => {
    const cwd = await makeNextApp();
    // A directory where the login page goes, put there while the project is
    // created: the dry run has passed, and the real patch merges `.env.local`
    // before it reaches the page.
    const capture = await startCreateProjectCaptureServer({
      onCreateProject: async () => {
        await mkdir(join(cwd, "app/login/page.tsx"), { recursive: true });
      },
    });

    const res = await runSetup(cwd, capture.url);

    expect(res.exitCode).toBe(3);
    expect(existsSync(join(cwd, ".env.local"))).toBe(false);
  });
});

describe("the credential env files a failed setup rolls back", () => {
  it("puts back one that existed and removes one setup created", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, ".env.local"), "KEEP=1\n");
    const before = await readCredentialEnvFiles(cwd);
    await writeFile(join(cwd, ".env.local"), "KEEP=1\nZITADEL_PROJECT_ID=abandoned\n");
    await writeFile(join(cwd, ".env.development.local"), "ZITADEL_PROJECT_ID=abandoned\n");

    await restoreCredentialEnvFiles(cwd, before);

    expect(await readFile(join(cwd, ".env.local"), "utf8")).toBe("KEEP=1\n");
    expect(existsSync(join(cwd, ".env.development.local"))).toBe(false);
  });

  it("does not read a file it cannot open as one that is absent", async () => {
    const cwd = await makeTempDir();
    // A directory where the file should be reads as EISDIR, not ENOENT: treating
    // it as absent would let the rollback delete something it should restore.
    await mkdir(join(cwd, ".env.development.local"));

    await expect(readCredentialEnvFiles(cwd)).rejects.toMatchObject({ code: "EISDIR" });
  });

  it("reports a file it cannot restore as a warning instead of throwing", async () => {
    const cwd = await makeTempDir();
    // Writing a file over a directory fails, as an unrestorable file would.
    await mkdir(join(cwd, ".env.local"));
    takeReportedWarnings();

    await expect(
      restoreCredentialEnvFiles(cwd, new Map([[".env.local", Buffer.from("KEEP=1\n")]])),
    ).resolves.toBeUndefined();

    expect(takeReportedWarnings()).toEqual([
      expect.stringContaining("Could not restore .env.local"),
    ]);
  });
});

describe("setup --design removal (#1039)", () => {
  it("--help no longer offers a login design", async () => {
    const res = await runCliForTest(["setup", "--help"]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).not.toContain("--design");
  });

  it("rejects --design with a targeted hint, before any project is created", async () => {
    const cwd = await makeTempDir();
    const capture = await startCreateProjectCaptureServer();

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--design",
      "split",
      "--server",
      capture.url,
      "--non-interactive",
      "--json",
    ]);

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as {
      code: string;
      message: string;
      hint: string;
      next_commands: string[];
    };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("no longer applies a login template");
    expect(json.hint).toContain("--zl-*");
    expect(json.next_commands.join("\n")).toContain("branding eject");
    expect(capture.requests).toEqual([]);
    expect(existsSync(join(cwd, ".zitadel"))).toBe(false);
  });
});

describe("setup --sso flags", () => {
  it("refuses a provider with no client id before touching the directory", async () => {
    const cwd = await makeTempDir();

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--non-interactive",
      "--json",
      "--sso",
      "google",
    ]);

    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as { status: string; code: string; message?: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("--sso-client-id");
  });

  it("refuses a client id with no provider", async () => {
    const cwd = await makeTempDir();

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--non-interactive",
      "--json",
      "--sso-client-id",
      "1234-abc.apps.googleusercontent.com",
    ]);

    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as { status: string; code: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_VALIDATION");
  });

  it("rejects a provider the catalog does not know", async () => {
    const cwd = await makeTempDir();

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--non-interactive",
      "--json",
      "--sso",
      "myspace",
      "--sso-client-id",
      "abc",
    ]);

    expect(res.exitCode).not.toBe(0);
  });
});

describe("setup --renderer surface", () => {
  it("--help advertises only implemented renderers", async () => {
    const res = await runCliForTest(["setup", "--help"]);

    expect(res.exitCode).toBe(0);
    // oclif renders the flag's `options` as `<options: a|b>`; a renderer that
    // getRenderer would reject with E_NOT_IMPLEMENTED must not be offered as
    // a selectable value, only mentioned as not yet available (ADR 006).
    // Whitespace is collapsed because oclif wraps help text mid-sentence.
    const help = res.stdout.replace(/\s+/g, " ");
    expect(res.stdout).toContain("<options: react>");
    expect(help).not.toContain("react|web-component");
    expect(help).toContain("Not yet available: web-component.");
  });

  it("rejects a declared-but-unpublished renderer at parse time", async () => {
    const cwd = await makeTempDir();

    const res = await runCliForTest([
      "setup",
      "--cwd",
      cwd,
      "--renderer",
      "web-component",
      "--non-interactive",
      "--json",
    ]);

    // Fails during flag parsing — before any remote project is created. The
    // registry's E_NOT_IMPLEMENTED path still guards renderer ids read from
    // persisted config (see the renderer registry unit tests).
    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { status: string; code: string; message: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("web-component");
  });
});

describe("setup summary", () => {
  type SummaryInput = Parameters<typeof buildSummary>[0];
  const input: Omit<SummaryInput, "scaffoldedFramework" | "scaffoldedBesideFiles"> = {
    projectFacts: { framework: "next", typescript: true, packageManager: "npm" },
    writtenRel: [],
    depsAdded: [],
    project: { id: "proj_test" } as SummaryInput["project"],
    server: "http://localhost:8080",
    issuer: "http://localhost:3000",
    sso: [],
  };
  const scaffoldRow = (over: Pick<SummaryInput, "scaffoldedFramework" | "scaffoldedBesideFiles">) =>
    buildSummary({ ...input, ...over })
      .find((section) => section.title === "Detected")
      ?.rows.find((row) => row.label === "Scaffold");

  it("calls a scaffold a new project, without claiming the directory was empty", () => {
    // The directory `start` ran in still holds its runtime and .gitignore.
    expect(scaffoldRow({ scaffoldedFramework: true, scaffoldedBesideFiles: false })?.value).toBe(
      "new project",
    );
  });

  it("says when --force scaffolded over files the directory already held", () => {
    expect(scaffoldRow({ scaffoldedFramework: true, scaffoldedBesideFiles: true })?.value).toBe(
      "new project over existing files (--force)",
    );
  });

  it("has no scaffold row for an app that already existed", () => {
    expect(
      scaffoldRow({ scaffoldedFramework: false, scaffoldedBesideFiles: false }),
    ).toBeUndefined();
  });
});

async function startHealthServer(): Promise<string> {
  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200).end("ok");
      return;
    }
    res.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "localhost", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("health server did not expose a TCP address");
  }
  return `http://localhost:${String(address.port)}`;
}

async function startNotFoundServer(): Promise<string> {
  const server = createServer((_req, res) => {
    res
      .writeHead(404, { "content-type": "application/json" })
      .end(JSON.stringify({ message: "not found" }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "localhost", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("not-found server did not expose a TCP address");
  }
  return `http://localhost:${String(address.port)}`;
}

async function startCreateProjectCaptureServer(
  opts: {
    /** Runs before `POST /projects` is answered: after setup's dry-run patch, before its real one. */
    onCreateProject?: () => Promise<void>;
  } = {},
): Promise<{
  url: string;
  body: Record<string, unknown> | null;
  requests: string[];
  /** Every project created, in order. */
  projects: Array<{ id: string; project_secret: string }>;
  /** Makes `POST /schemas` fail, so setup fails after it created the project. */
  rejectsSchemaUploads(): void;
  /** Lets `POST /schemas` succeed again. */
  recovers(): void;
}> {
  let body: Record<string, unknown> | null = null;
  let rejectsSchemas = false;
  const requests: string[] = [];
  const projects: Array<{ id: string; project_secret: string }> = [];
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    requests.push(`${req.method ?? "GET"} ${path}`);
    if (req.method === "POST" && path === "/projects") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      await opts.onCreateProject?.();
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
    if (req.method === "POST" && path === "/schemas" && rejectsSchemas) {
      res
        .writeHead(500, { "content-type": "application/json" })
        .end(JSON.stringify({ code: "internal", message: "boom" }));
      return;
    }
    if (req.method === "POST" && path === "/schemas") {
      res.writeHead(201, { "content-type": "application/json" }).end(
        JSON.stringify({
          id: "sch_test",
          created_at: "2026-06-01T00:00:00.000Z",
        }),
      );
      return;
    }
    if (req.method === "POST" && path === "/flow_definitions") {
      res.writeHead(201, { "content-type": "application/json" }).end(
        JSON.stringify({
          id: "flow_test",
          created_at: "2026-06-01T00:00:00.000Z",
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "localhost", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("capture server did not expose a TCP address");
  }
  return {
    url: `http://localhost:${String(address.port)}`,
    get body() {
      return body;
    },
    requests,
    projects,
    rejectsSchemaUploads() {
      rejectsSchemas = true;
    },
    recovers() {
      rejectsSchemas = false;
    },
  };
}

/** A detectable Next.js app with no Zitadel files yet. */
async function makeNextApp(): Promise<string> {
  const cwd = await makeTempDir();
  await mkdir(join(cwd, "app"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "demo", dependencies: { next: "^16" } }),
  );
  return cwd;
}

/** Runs a scripted setup of `cwd` against `server`, skipping the install. */
function runSetup(cwd: string, server: string, extra: string[] = []) {
  return runCliForTest([
    "setup",
    "--cwd",
    cwd,
    "--server",
    server,
    "--non-interactive",
    "--json",
    "--skip-install",
    ...extra,
  ]);
}

/** The `KEY=value` lines of an env file. */
function envEntries(contents: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match?.[1] !== undefined) {
      entries[match[1]] = match[2] ?? "";
    }
  }
  return entries;
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

/** A binary runtime as `start` records it, running `serverVersion`. */
function binaryRuntimeFor(cwd: string, serverUrl: string, serverVersion: string): RuntimeMetadata {
  return {
    schema_version: 1,
    backend: "binary",
    pid: process.pid,
    command: process.execPath,
    log_path: localRuntimePaths(cwd).logFile,
    server_package: "@zitadel/server",
    server_version: serverVersion,
    port: Number(new URL(serverUrl).port),
    server_url: serverUrl,
    data_dir: localRuntimePaths(cwd).dataDir,
    created_at: "2026-06-09T00:00:00.000Z",
    cli_version: serverVersion,
  };
}
