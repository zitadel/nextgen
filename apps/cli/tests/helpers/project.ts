import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { expect, onTestFinished } from "vitest";

import { parseJson, runCliForTest } from "./run-cli";

/**
 * A scaffolded app for the specs to drive the CLI against, so a spec can read
 * as the journey it describes rather than as the plumbing that sets it up.
 * Every method runs the real built CLI against the mock platform and returns
 * what a developer could observe afterwards.
 *
 * Keep paths, flag spellings, stdin plumbing and fake binaries in here; keep
 * assertions in the spec (`tests/AGENTS.md`).
 */

/** Where the mock platform answers. Not a real host; msw intercepts it. */
export const MOCK_SERVER_URL = "http://mock.zitadel.test";

/** What `plan` reports when the project and the platform already agree. */
export const NOTHING_TO_RECONCILE = { creates: 0, updates: 0, deletes: 0, total: 0 };

export interface Credentials {
  readonly clientId: string;
  readonly secret: string;
}

export interface FlowStep {
  readonly name: string;
  readonly sso_providers?: string[];
  readonly transitions?: Record<string, unknown>;
  readonly fields?: string[];
}

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The envelope every command emits under `--json`. */
export interface Envelope<T = Record<string, unknown>> {
  readonly status: "ok" | "skipped" | "error";
  readonly code?: string;
  readonly message?: string;
  readonly hint?: string;
  readonly next_commands?: string[];
  readonly cli_version?: string;
  readonly command?: string;
  readonly source?: string;
  readonly data: T;
}

interface SyncState {
  readonly resources: Record<
    string,
    { id?: string; previousId?: string; hash?: string; name?: string; status?: string }
  >;
  readonly scaffold?: {
    files: Record<string, { hash: string; class: string }>;
    scaffolded_framework?: boolean;
    posture?: string;
  };
}

/**
 * A port from this worker's own block. A bind-then-close probe races the other
 * vitest workers — a reserved port gets taken as an outbound source port
 * before the CLI binds it — so each worker counts through a disjoint range
 * instead (the same reasoning as `apps/cli-journey-e2e/scripts/ports.mjs`).
 *
 * Indexed by `VITEST_POOL_ID`, the reusable 1-based pool slot. `VITEST_WORKER_ID`
 * is a unique worker identity that keeps climbing as files spawn workers, so
 * indexing by it walks the block past 65535 and hands the CLI a port that
 * cannot exist. The modulo keeps every block inside the range regardless.
 */
const PORT_FIRST = 42_000;
const PORT_LAST = 65_000;
const PORT_BLOCK = 200;
const PORT_BLOCKS = Math.floor((PORT_LAST - PORT_FIRST) / PORT_BLOCK);
const POOL_SLOT = Math.max(1, Number(process.env.VITEST_POOL_ID ?? 1));
const PORT_BASE = PORT_FIRST + ((POOL_SLOT - 1) % PORT_BLOCKS) * PORT_BLOCK;
let portOffset = 0;
function nextPort(): number {
  return PORT_BASE + (portOffset++ % PORT_BLOCK);
}

export class ScaffoldedApp {
  constructor(readonly path: string) {}

  // ---------------------------------------------------------------- commands

  /** Scaffolds the project. Installs through a fake npm unless skipped. */
  async setup(
    extraArgs: string[] = [],
    { install = false }: { install?: boolean } = {},
  ): Promise<CliResult> {
    if (!install) {
      return this.cli(["setup", "--non-interactive", "--json", "--skip-install", ...extraArgs]);
    }
    const npm = await fakePackageManager();
    this.installLogPath = npm.logPath;
    return this.cli(["setup", "--non-interactive", "--json", ...extraArgs], {
      PACKAGE_MANAGER_LOG: npm.logPath,
      PATH: `${npm.binDir}:${process.env.PATH ?? ""}`,
    });
  }

  /** Runs `setup` again, as a developer retrying would. */
  async setupAgain(extraArgs: string[] = []): Promise<CliResult> {
    return this.cli(["setup", "--json", ...extraArgs]);
  }

  /**
   * Runs `setup` with a provider enabled. The client secret is never a flag,
   * so it is piped the way a script would pipe it.
   */
  async setupWithSso(provider: string, credentials: Credentials): Promise<CliResult> {
    return this.pipingSecret(credentials.secret, () =>
      this.setup([
        "--framework",
        "next",
        "--sso",
        provider,
        "--sso-client-id",
        credentials.clientId,
      ]),
    );
  }

  /** Runs `sso enable` on an already-set-up project. */
  async enableSso(provider: string, credentials: Credentials): Promise<CliResult> {
    return this.pipingSecret(credentials.secret, () =>
      this.cli([
        "sso",
        "enable",
        "--non-interactive",
        "--json",
        "--provider",
        provider,
        "--client-id",
        credentials.clientId,
      ]),
    );
  }

  /** Runs `doctor` against a fake docker on PATH and a port from this worker. */
  async doctor(extraArgs: string[] = []): Promise<CliResult> {
    const docker = await fakeDocker();
    return this.cli(["doctor", "--json", ...extraArgs, "--port", String(nextPort())], {
      PATH: `${docker.binDir}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: docker.logPath,
    });
  }

  async status(extraArgs: string[] = []): Promise<CliResult> {
    return this.cli(["status", "--json", ...extraArgs]);
  }

  async apply(extraArgs: string[] = []): Promise<CliResult> {
    return this.cli(["apply", "--non-interactive", "--json", ...extraArgs]);
  }

  /** `plan`'s raw result, for a spec asserting its rendered output. */
  async planRaw(extraArgs: string[] = []): Promise<CliResult> {
    return this.cli(["plan", "--non-interactive", ...extraArgs]);
  }

  /** The totals `plan` reports, for comparison against `NOTHING_TO_RECONCILE`. */
  async plan(): Promise<{ creates: number; updates: number; deletes: number; total: number }> {
    const result = await this.cli(["plan", "--non-interactive", "--json"]);
    if (result.exitCode !== 0) {
      throw new Error(`plan exited ${result.exitCode}: ${result.stderr || result.stdout}`);
    }
    return this.envelopeOf(result).data as {
      creates: number;
      updates: number;
      deletes: number;
      total: number;
    };
  }

  /** Runs an arbitrary command, for a spec whose subject has no helper yet. */
  run(args: string[], env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
    return this.cli(args, env);
  }

  /**
   * Runs a command whose output oclif owns rather than our envelope — an
   * unknown command, `--help`, `--version`. Skips the envelope check that
   * every other invocation gets.
   */
  runUnenveloped(args: string[], env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
    return this.cli(args, env, { envelope: false });
  }

  /**
   * Runs the CLI without `--server`, so the spec observes which server the CLI
   * resolves on its own.
   */
  async runWithoutServer(args: string[], env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
    const result = await runCliForTest([...args, "--cwd", this.path], env);
    if (args.includes("--json")) {
      assertEnvelope(result, args);
    }
    return result;
  }

  /** Writes a file into the project, for a spec arranging a specific state. */
  writeProjectFile(relativePath: string, contents: string): Promise<void> {
    return writeFile(join(this.path, relativePath), contents);
  }

  /** Whether a path exists in the project. */
  async hasProjectFile(relativePath: string): Promise<boolean> {
    try {
      await stat(join(this.path, relativePath));
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------ observations

  /** The parsed `--json` envelope. Throws with the output when it is not JSON. */
  envelopeOf<T = Record<string, unknown>>(result: CliResult): Envelope<T> {
    try {
      return parseJson(result.stdout) as Envelope<T>;
    } catch {
      throw new Error(`expected a JSON envelope on stdout, got: ${result.stdout || "(empty)"}`);
    }
  }

  /** The error code from a failing command's envelope, or undefined. */
  codeOf(result: CliResult): string | undefined {
    try {
      return (parseJson(result.stdout) as { code?: string }).code;
    } catch {
      return undefined;
    }
  }

  /** The committed connection file for a provider. */
  async idpConnection(
    slug: string,
  ): Promise<{ oidc: { client_id: string; client_secret: string } }> {
    return this.readDocument(`.zitadel/idps/${slug}.json`) as Promise<{
      oidc: { client_id: string; client_secret: string };
    }>;
  }

  /** The user schema, whose `x-auth-methods` says which methods are offered. */
  async userSchema(): Promise<{
    "x-auth-methods": { sso?: { enabled: boolean; providers: string[] } };
    properties: Record<string, unknown>;
  }> {
    return this.readDocument(".zitadel/schemas/default-human-user.json") as Promise<{
      "x-auth-methods": { sso?: { enabled: boolean; providers: string[] } };
      properties: Record<string, unknown>;
    }>;
  }

  /** The login flow definition. */
  async loginFlow(): Promise<{ steps: FlowStep[]; user_schema: string }> {
    return this.readDocument(".zitadel/flows/default-login.json") as Promise<{
      steps: FlowStep[];
      user_schema: string;
    }>;
  }

  /** Sync state: server-assigned ids, content hashes, the scaffold manifest. */
  async syncState(): Promise<SyncState> {
    return this.readDocument(".zitadel/state.json") as unknown as Promise<SyncState>;
  }

  /** What the fake npm was asked to do, for the install leg of setup. */
  async installInvocation(): Promise<{ cwd: string; args: string[] }> {
    if (this.installLogPath === undefined) {
      throw new Error("setup was not run with { install: true }");
    }
    const log = (await readFile(this.installLogPath, "utf8")).trim();
    return JSON.parse(log) as { cwd: string; args: string[] };
  }

  /** Every document the CLI wrote, as one string, to assert a value is absent. */
  async writtenConfig(slug: string): Promise<string> {
    return JSON.stringify(await this.documents(slug));
  }

  /** The three documents, to compare a rerun against an earlier run. */
  async documents(slug: string): Promise<Record<string, unknown>> {
    const [connection, userSchema, loginFlow] = await Promise.all([
      this.readDocument(`.zitadel/idps/${slug}.json`),
      this.readDocument(".zitadel/schemas/default-human-user.json"),
      this.readDocument(".zitadel/flows/default-login.json"),
    ]);
    return { connection, userSchema, loginFlow };
  }

  /**
   * The steps that actually offer a provider. The meta-schema defaults
   * `sso_providers` to `[]`, so the key's presence means nothing and only a
   * non-empty list is a step a sign-in can start from.
   */
  async stepsOfferingSso(): Promise<FlowStep[]> {
    const { steps } = await this.loginFlow();
    return steps.filter((step) => (step.sso_providers ?? []).length > 0);
  }

  /** Reads a file from the project. */
  readProjectFile(relativePath: string): Promise<string> {
    return readFile(join(this.path, relativePath), "utf8");
  }

  /** Rewrites a JSON document in the project, as a developer editing it would. */
  async editDocument(
    relativePath: string,
    edit: (document: Record<string, unknown>) => void,
  ): Promise<void> {
    const document = await this.readDocument(relativePath);
    edit(document);
    await writeFile(join(this.path, relativePath), `${JSON.stringify(document, null, 2)}\n`);
  }

  // ------------------------------------------------------------------ private

  private installLogPath: string | undefined;

  private async readDocument(relativePath: string): Promise<Record<string, unknown>> {
    const contents = await readFile(join(this.path, relativePath), "utf8");
    return JSON.parse(contents) as Record<string, unknown>;
  }

  private async cli(
    args: string[],
    env: NodeJS.ProcessEnv = {},
    { envelope = true }: { envelope?: boolean } = {},
  ): Promise<CliResult> {
    const result = await runCliForTest(
      [...args, "--cwd", this.path, "--server", MOCK_SERVER_URL],
      env,
    );
    if (envelope && args.includes("--json")) {
      assertEnvelope(result, args);
    }
    return result;
  }

  /**
   * `runCliForTest` runs in-process, so a scripted run would otherwise read the
   * test runner's own stdin and block on a stream that never ends.
   */
  private async pipingSecret<T>(secret: string, run: () => Promise<T>): Promise<T> {
    const original = Object.getOwnPropertyDescriptor(process, "stdin");
    Object.defineProperty(process, "stdin", {
      value: Readable.from([secret]),
      configurable: true,
    });
    try {
      return await run();
    } finally {
      if (original) {
        Object.defineProperty(process, "stdin", original);
      }
    }
  }
}

/**
 * The envelope contract, checked on every `--json` invocation a spec makes.
 *
 * It lives here rather than in a suite of its own because a dedicated contract
 * file only covers the commands somebody remembered to list, while this covers
 * every command any spec ever runs — and a command whose envelope regresses
 * fails in its own spec, where the cause is obvious.
 */
export function assertEnvelope(result: CliResult, args: string[] = []): void {
  const where = `\`${args.filter((arg) => !arg.startsWith("-")).join(" ")}\` --json`;
  let envelope: Envelope;
  try {
    envelope = parseJson(result.stdout) as Envelope;
  } catch {
    throw new Error(
      `${where} emitted no JSON envelope on stdout.\n` +
        `stdout: ${result.stdout || "(empty)"}\nstderr: ${result.stderr || "(empty)"}`,
    );
  }
  expect(envelope.cli_version, `${where}: cli_version missing`).toBeTypeOf("string");
  expect(envelope.command, `${where}: command missing`).toBeTypeOf("string");
  expect(envelope.source, `${where}: source missing`).toBeTypeOf("string");
  expect(envelope.status, `${where}: status missing or unknown`).toMatch(/^(ok|skipped|error)$/);
  // An error envelope is still an envelope, and must name the failure.
  if (envelope.status === "error") {
    expect(envelope.code, `${where}: error envelope carries no code`).toBeTypeOf("string");
  }
}

/**
 * A minimal app in a temp directory — the pre-existing-app posture `setup`
 * scaffolds into (ADR 044). Removes itself when the test finishes, so a spec
 * carries no teardown.
 */
export async function anApp({
  nextVersion = "^16.0.0",
}: { nextVersion?: string } = {}): Promise<ScaffoldedApp> {
  const path = await mkdtemp(join(tmpdir(), "zitadel-next-"));
  onTestFinished(() => rm(path, { recursive: true, force: true }));

  await mkdir(join(path, "app"), { recursive: true });
  await writeFile(
    join(path, "package.json"),
    JSON.stringify(
      {
        name: "demo-next-app",
        private: true,
        dependencies: { next: nextVersion, react: "^19.0.0", "react-dom": "^19.0.0" },
      },
      null,
      2,
    ),
  );
  await writeFile(join(path, ".gitignore"), "node_modules\n");
  await writeFile(
    join(path, "app/layout.tsx"),
    "export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n",
  );
  return new ScaffoldedApp(path);
}

/** A Next app that has already been through `setup`, for specs about later commands. */
export async function aSetUpApp(extraArgs: string[] = []): Promise<ScaffoldedApp> {
  const app = await anApp();
  const result = await app.setup(extraArgs);
  if (result.exitCode !== 0) {
    throw new Error(`arranging setup failed (${result.exitCode}): ${result.stderr}`);
  }
  return app;
}

/**
 * A fake `npm` on PATH that records its invocation instead of installing.
 * Faking an external binary is allowed; faking our own modules is not.
 */
async function fakePackageManager(): Promise<{ binDir: string; logPath: string }> {
  const binDir = await mkdtemp(join(tmpdir(), "zitadel-fake-pm-"));
  onTestFinished(() => rm(binDir, { recursive: true, force: true }));
  const logPath = join(binDir, "package-manager.log");
  const binPath = join(binDir, "npm");
  await writeFile(
    binPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(
  process.env.PACKAGE_MANAGER_LOG,
  JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + "\\n",
);
process.stdout.write("fake npm stdout\\n");
process.stderr.write("fake npm stderr\\n");
`,
  );
  await chmod(binPath, 0o755);
  return { binDir, logPath };
}

/** A fake `docker` on PATH, so doctor's runtime probe does not need a daemon. */
async function fakeDocker(): Promise<{ binDir: string; logPath: string }> {
  const binDir = await mkdtemp(join(tmpdir(), "zitadel-fake-docker-"));
  onTestFinished(() => rm(binDir, { recursive: true, force: true }));
  const logPath = join(binDir, "docker.log");
  const dockerPath = join(binDir, "docker");
  await writeFile(
    dockerPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DOCKER_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "version") process.stdout.write("27.0.0\\n");
`,
  );
  await chmod(dockerPath, 0o755);
  return { binDir, logPath };
}
