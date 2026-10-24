import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { expect } from "vitest";

import { aFakeAppGeneratorPath } from "./app-generator";
import { aFakeServerBinary, trackLocalServerDir, type ServerShape } from "./local-server";
import { cliPackageRoot } from "./oclif-build";
import { nextPort } from "./ports";
import { aBinaryRecord } from "./runtime-record";
import { parseJson, runCliForTest } from "./run-cli";

const SCHEMA_FILE = ".zitadel/schemas/default-human-user.json";
const FLOW_FILE = ".zitadel/flows/default-login.json";

/** Where the mock platform answers. Not a real host; msw intercepts it. */
export const MOCK_SERVER_URL = "http://mock.zitadel.test";

export interface Credentials {
  readonly clientId: string;
  readonly secret: string;
}

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Envelope<T = Record<string, unknown>> {
  readonly status: "ok" | "skipped" | "error";
  readonly code?: string;
  readonly message?: string;
  readonly hint?: string;
  readonly next_commands?: string[];
  readonly warnings?: string[];
  readonly cli_version?: string;
  readonly command?: string;
  readonly source?: string;
  readonly data: T;
}

export interface PlanTotals {
  readonly creates: number;
  readonly updates: number;
  readonly deletes: number;
  readonly total: number;
}

export interface FlowStep {
  readonly name: string;
  readonly sso_providers?: string[];
  readonly transitions?: Record<string, unknown>;
  readonly fields?: string[];
}

export interface PublishedSchema {
  readonly id: string;
  readonly schema: {
    readonly "x-auth-methods"?: Record<string, { enabled: boolean; providers?: string[] }>;
    readonly properties: Record<string, unknown>;
  };
}

export interface PublishedFlow {
  readonly id: string;
  readonly flow_definition: {
    readonly name: string;
    readonly status: string;
    readonly user_schema: string;
    readonly purposes: Record<string, string>;
    readonly steps: FlowStep[];
  };
}

export interface ProjectVariable {
  readonly name: string;
  readonly value?: string;
  readonly secret?: boolean;
}

export interface RegisteredIdp {
  readonly id: string;
  readonly slug: string;
}

/**
 * What a command did to the project, as a tree rather than as content.
 *
 * A spec asserts that a file was written, removed or left alone; whether its
 * bytes are right is the patcher's own unit test.
 */
export interface ProjectChanges {
  readonly added: string[];
  readonly modified: string[];
  readonly removed: string[];
  readonly unchanged: string[];
}

/** The user schema as committed, which the developer owns and edits. */
export interface UserSchemaDocument {
  properties: Record<string, unknown>;
  "x-auth-methods"?: Record<string, { enabled: boolean; providers?: string[] }>;
}

/** A connection file as committed, which the developer owns and edits. */
export interface ConnectionDocument {
  slug: string;
  protocol?: string;
  display_name?: string;
  subject_claim?: string;
  oidc: { issuer: string; client_id?: string; client_secret?: string; scopes?: string[] };
  claim_mapping?: Record<string, string>;
  verified_claims?: Record<string, string>;
}

/** The login flow as committed, which the developer owns and edits. */
export interface FlowDocument {
  purposes: Record<string, string>;
  steps: Array<{
    name: string;
    fields?: string[];
    actions?: Array<{ name: string; text_key?: string }>;
    transitions?: Record<string, unknown>;
    sso_providers?: string[];
  }>;
}

interface PackageJson {
  dependencies: Record<string, string>;
}

/**
 * Files the developer commits and hand-edits.
 *
 * A spec reads one only where the committed content is itself the behaviour —
 * chiefly that a credential is published as a reference and never written in
 * literally, because a secret in version control cannot be scrubbed later.
 */
class CommittedFiles {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  idpConnection(slug: string): Promise<{ oidc: { client_id: string; client_secret: string } }> {
    return this.read(`.zitadel/idps/${slug}.json`) as Promise<{
      oidc: { client_id: string; client_secret: string };
    }>;
  }

  /** The ejected branding descriptor. */
  brandingDescriptor(): Promise<Record<string, unknown>> {
    return this.read(".zitadel/branding/branding.json");
  }

  /** Every committed configuration document as one string. */
  async asText(slug: string): Promise<string> {
    const documents = await Promise.all([
      this.read(`.zitadel/idps/${slug}.json`),
      this.read(SCHEMA_FILE),
      this.read(FLOW_FILE),
    ]);
    return JSON.stringify(documents);
  }

  private async read(relativePath: string): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(join(this.root, relativePath), "utf8")) as Record<
      string,
      unknown
    >;
  }
}

/** What a developer says about a connection the catalog does not list. */
export type CustomConnection = {
  slug: string;
  displayName: string;
  issuer: string;
  scopes?: string;
};

/** The flags describing a connection, under `--` for `auth-method sso enable` or `--sso-` for `setup`. */
function customFlags(connection: CustomConnection, prefix: string): string[] {
  return [
    `${prefix}slug`,
    connection.slug,
    `${prefix}display-name`,
    connection.displayName,
    `${prefix}issuer`,
    connection.issuer,
    ...(connection.scopes === undefined ? [] : [`${prefix}scopes`, connection.scopes]),
  ];
}

/**
 * A scaffolded app for the specs to drive the CLI against.
 *
 * Observations run a command, because a spec's subject is how the CLI behaves
 * and not how it stores things: a corrupt file matters only insofar as a later
 * command surfaces it. Sync state and the mock's own store are never read.
 */
export class ScaffoldedApp {
  readonly path: string;
  readonly committed: CommittedFiles;

  constructor(path: string) {
    this.path = path;
    this.committed = new CommittedFiles(path);
  }

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

  /**
   * `setup --framework next` in a directory without an app, so setup creates
   * one: with stand-ins for the generator on PATH, nothing is downloaded.
   */
  async setupNewApp(extraArgs: string[] = []): Promise<CliResult> {
    return this.cli(
      [
        "setup",
        "--non-interactive",
        "--json",
        "--skip-install",
        "--framework",
        "next",
        ...extraArgs,
      ],
      { PATH: await aFakeAppGeneratorPath() },
    );
  }

  /** The client secret is never a flag, so it is piped as a script would. */
  setupWithSso(provider: string, credentials: Credentials): Promise<CliResult> {
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

  /**
   * `auth-method sso enable` without `--json`, for a spec asserting what the
   * developer reads.
   */
  enableSsoRendered(provider: string, credentials: Credentials): Promise<CliResult> {
    return this.pipingStdin(credentials.secret, () =>
      this.cli([
        "auth-method",
        "sso",
        "enable",
        "--non-interactive",
        "--provider",
        provider,
        "--client-id",
        credentials.clientId,
      ]),
    );
  }

  /** `auth-method sso enable --dry-run` without `--json`, for a spec asserting what the developer reads. */
  enableSsoDryRun(provider: string, credentials: Credentials): Promise<CliResult> {
    return this.pipingStdin(credentials.secret, () =>
      this.cli([
        "auth-method",
        "sso",
        "enable",
        "--non-interactive",
        "--dry-run",
        "--provider",
        provider,
        "--client-id",
        credentials.clientId,
      ]),
    );
  }

  enableSso(provider: string, credentials: Credentials): Promise<CliResult> {
    return this.pipingSecret(credentials.secret, () =>
      this.cli([
        "auth-method",
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

  /** `auth-method password|passkey enable`. */
  enableMethod(method: "password" | "passkey", extraArgs: string[] = []): Promise<CliResult> {
    return this.cli(["auth-method", method, "enable", "--non-interactive", "--json", ...extraArgs]);
  }

  /** `auth-method password|passkey disable`. */
  disableMethod(method: "password" | "passkey", extraArgs: string[] = []): Promise<CliResult> {
    return this.cli([
      "auth-method",
      method,
      "disable",
      "--non-interactive",
      "--json",
      ...extraArgs,
    ]);
  }

  /**
   * `auth-method password|passkey enable` without `--json`, for what the
   * developer reads.
   */
  enableMethodRendered(method: "password" | "passkey"): Promise<CliResult> {
    return this.cli(["auth-method", method, "enable", "--non-interactive"]);
  }

  /**
   * `auth-method password|passkey disable` without `--json`, for what the
   * developer reads.
   */
  disableMethodRendered(method: "password" | "passkey"): Promise<CliResult> {
    return this.cli(["auth-method", method, "disable", "--non-interactive"]);
  }

  /**
   * `auth-method sso disable` without `--json`, for what the developer reads.
   */
  disableSsoRendered(provider: string): Promise<CliResult> {
    return this.cli(["auth-method", "sso", "disable", "--non-interactive", "--provider", provider]);
  }

  /** `auth-method sso disable`. */
  disableSso(provider: string, extraArgs: string[] = []): Promise<CliResult> {
    return this.cli([
      "auth-method",
      "sso",
      "disable",
      "--non-interactive",
      "--json",
      "--provider",
      provider,
      ...extraArgs,
    ]);
  }

  /** `auth-method sso enable` for a connection the developer describes, secret piped as a script would. */
  enableCustomSso(connection: CustomConnection, credentials: Credentials): Promise<CliResult> {
    return this.enableSsoWith(
      [
        "--provider",
        "custom",
        ...customFlags(connection, "--"),
        "--client-id",
        credentials.clientId,
      ],
      credentials.secret,
    );
  }

  /** `auth-method sso enable` with exactly these flags, for a spec asserting how it refuses. */
  enableSsoWith(args: string[], secret = "a-client-secret"): Promise<CliResult> {
    return this.pipingSecret(secret, () =>
      this.cli(["auth-method", "sso", "enable", "--non-interactive", "--json", ...args]),
    );
  }

  /** `setup` with a custom connection, without `--json`, for a spec asserting what the developer reads. */
  setupWithCustomSsoRendered(
    connection: CustomConnection,
    credentials: Credentials,
  ): Promise<CliResult> {
    return this.pipingSecret(credentials.secret, () =>
      this.cli([
        "setup",
        "--non-interactive",
        "--skip-install",
        "--framework",
        "next",
        "--sso",
        "custom",
        ...customFlags(connection, "--sso-"),
        "--sso-client-id",
        credentials.clientId,
      ]),
    );
  }

  /** `setup` with exactly these flags and this on stdin, for a spec asserting how it refuses. */
  setupSsoWith(args: string[], secret: string): Promise<CliResult> {
    return this.pipingSecret(secret, () => this.setup(["--framework", "next", ...args]));
  }

  /** `setup` with a custom connection described on the command line. */
  setupWithCustomSso(connection: CustomConnection, credentials: Credentials): Promise<CliResult> {
    return this.setupSsoWith(
      [
        "--sso",
        "custom",
        ...customFlags(connection, "--sso-"),
        "--sso-client-id",
        credentials.clientId,
      ],
      credentials.secret,
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

  /** An app in a directory inside this one, the way a developer nests one under `start`. */
  async appInside(name: string): Promise<ScaffoldedApp> {
    await mkdir(join(this.path, name), { recursive: true });
    return new ScaffoldedApp(join(this.path, name));
  }

  /** Runs `doctor` without naming a port, so it checks the one this directory's server uses. */
  async doctorAtItsServer(): Promise<CliResult> {
    const docker = await fakeDocker();
    return this.cli(["doctor", "--json"], {
      PATH: `${docker.binDir}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: docker.logPath,
    });
  }

  /** The port a `doctor` run reported it checked. */
  doctoredPortOf(result: CliResult): number {
    return this.envelopeOf<{ port: number }>(result).data.port;
  }

  /** The argument lists a failed `doctor` run offered as recovery, for an agent to run as they are. */
  suggestedArgsOf(result: CliResult): string[][] {
    const { details } = this.envelopeOf<Record<string, unknown>>(result) as unknown as {
      details?: { suggested_args?: string[][] };
    };
    return details?.suggested_args ?? [];
  }

  /** Leaves this directory with the record of a local server that is not running. */
  async writeStoppedServerRecord(): Promise<void> {
    await mkdir(join(this.path, ".zitadel/local"), { recursive: true });
    await writeFile(
      join(this.path, ".zitadel/local/runtime.json"),
      JSON.stringify(aBinaryRecord({ port: nextPort() })),
    );
  }

  /** Leaves this directory with a record of its local server that is JSON but not a record. */
  async writeMalformedServerRecord(): Promise<void> {
    await mkdir(join(this.path, ".zitadel/local"), { recursive: true });
    await writeFile(join(this.path, ".zitadel/local/runtime.json"), JSON.stringify({ x: 1 }));
  }

  /**
   * Starts this app's local server from a stand-in for the server binary, on a
   * port from this worker unless one is named.
   */
  async startLocalServer({
    shape = "plain",
    port = nextPort(),
  }: {
    shape?: ServerShape;
    port?: number;
  } = {}): Promise<CliResult> {
    trackLocalServerDir(this.path);
    return this.cli(["start", "--port", String(port), "--json"], {
      ZITADEL_SERVER_BINARY: await aFakeServerBinary(shape),
    });
  }

  /** Starts the server again without naming a port, so the one the directory had is used. */
  async restartLocalServer(): Promise<CliResult> {
    trackLocalServerDir(this.path);
    return this.cli(["start", "--json"], {
      ZITADEL_SERVER_BINARY: await aFakeServerBinary("plain"),
    });
  }

  /**
   * Two starts racing in this app's directory, each its own process: the
   * in-process runner captures output globally, so two runs at once in it
   * would garble each other's.
   */
  async startLocalServerTwiceAtOnce(): Promise<CliResult[]> {
    trackLocalServerDir(this.path);
    const env = { ...process.env, ZITADEL_SERVER_BINARY: await aFakeServerBinary("plain") };
    const port = String(nextPort());
    const results = await Promise.all(
      [0, 1].map(
        () =>
          new Promise<CliResult>((resolve) => {
            execFile(
              process.execPath,
              [
                join(cliPackageRoot, "bin/run.js"),
                ...["start", "--cwd", this.path, "--server", MOCK_SERVER_URL],
                ...["--port", port, "--json"],
              ],
              { env },
              (error, stdout, stderr) =>
                resolve({
                  exitCode: typeof error?.code === "number" ? error.code : 0,
                  stdout,
                  stderr,
                }),
            );
          }),
      ),
    );
    return results;
  }

  /** The port a start reported its server on. */
  localPortOf(result: CliResult): number {
    return this.localRuntimeOf(result).port;
  }

  /** The process a start reported its server as. */
  localPidOf(result: CliResult): number {
    return this.localRuntimeOf(result).pid;
  }

  /** The server a start reported; a refused start fails here with its error code. */
  private localRuntimeOf(result: CliResult): { port: number; pid: number } {
    expect(result, "start should have succeeded").toSucceed();
    return this.envelopeOf<{ runtime: { port: number; pid: number } }>(result).data.runtime;
  }

  /** Leaves this directory with a record of its local server that cannot be read. */
  async corruptLocalServerRecord(): Promise<void> {
    await mkdir(join(this.path, ".zitadel/local"), { recursive: true });
    await writeFile(join(this.path, ".zitadel/local/runtime.json"), "{not json");
  }

  /** The log lines a `logs --json` run returned. */
  loggedLinesOf(result: CliResult): string[] {
    expect(result, "logs should have succeeded").toSucceed();
    const { logs } = this.envelopeOf<{ logs: string }>(result).data;
    return logs.split("\n").filter((line) => line !== "");
  }

  /** The lifecycle `status` reports for the local server. */
  async localServerLifecycle(): Promise<string> {
    const status = await this.cli(["status", "--json"]);
    return this.envelopeOf<{ server: { lifecycle: string } }>(status).data.server.lifecycle;
  }

  status(extraArgs: string[] = []): Promise<CliResult> {
    return this.cli(["status", "--json", ...extraArgs]);
  }

  apply(extraArgs: string[] = []): Promise<CliResult> {
    return this.cli(["apply", "--non-interactive", "--json", ...extraArgs]);
  }

  /** The totals `plan` reports, for a plan expected to succeed. */
  async plan(): Promise<PlanTotals> {
    const result = await this.planAttempt();
    expect(result, "plan should have succeeded").toSucceed();
    return this.envelopeOf<PlanTotals>(result).data;
  }

  /** `plan` as a raw result, for a spec asserting a refusal. */
  planAttempt(): Promise<CliResult> {
    return this.cli(["plan", "--non-interactive", "--json"]);
  }

  /** `plan` without `--json`, for a spec asserting what the developer reads. */
  planRendered(): Promise<CliResult> {
    return this.cli(["plan", "--non-interactive"]);
  }

  run(args: string[], env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
    return this.cli(args, env);
  }

  /** For output oclif owns rather than our envelope: `--help`, `--version`. */
  runUnenveloped(args: string[], env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
    return this.cli(args, env, { envelope: false });
  }

  /** Without `--server`, so the spec sees which server the CLI resolves itself. */
  async runWithoutServer(args: string[], env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
    const result = await runCliForTest([...args, "--cwd", this.path], env);
    if (args.includes("--json")) {
      assertEnvelope(result, args);
    }
    return result;
  }

  /** Sets a project variable, whose value is piped rather than passed as a flag. */
  setVariable(name: string, value: string, { secret = false } = {}): Promise<CliResult> {
    return this.pipingStdin(value, () =>
      this.cli([
        "variables",
        "set",
        name,
        "--project-level",
        "--json",
        ...(secret ? ["--secret"] : []),
      ]),
    );
  }

  /**
   * Sets a project variable when nothing was piped in: stdin is the keyboard,
   * which is what a script that forgot the pipe has.
   */
  setVariableWithNothingPiped(name: string, { secret = false } = {}): Promise<CliResult> {
    return this.withKeyboardOnStdin(() =>
      this.cli([
        "variables",
        "set",
        name,
        "--project-level",
        "--non-interactive",
        "--json",
        ...(secret ? ["--secret"] : []),
      ]),
    );
  }

  /** `zitadel api` with an operation and its arguments, as a script runs it. */
  api(...args: string[]): Promise<CliResult> {
    return this.cli(["api", ...args, "--non-interactive", "--json"]);
  }

  /** `zitadel api` with `body` piped in on stdin. */
  apiPiping(body: string, ...args: string[]): Promise<CliResult> {
    return this.pipingStdin(body, () => this.api(...args));
  }

  /** `zitadel api` without `--json`, for a spec asserting what the developer reads. */
  apiRendered(...args: string[]): Promise<CliResult> {
    return this.cli(["api", ...args, "--non-interactive"]);
  }

  /** `zitadel api ls` with its arguments. */
  apiOperations(...args: string[]): Promise<CliResult> {
    return this.cli(["api", "ls", ...args, "--non-interactive", "--json"]);
  }

  /** `zitadel api ls` without `--json`. */
  apiOperationsRendered(...args: string[]): Promise<CliResult> {
    return this.cli(["api", "ls", ...args, "--non-interactive"]);
  }

  getVariable(name: string): Promise<CliResult> {
    return this.cli(["variables", "get", name, "--project-level", "--json"]);
  }

  deleteVariable(name: string): Promise<CliResult> {
    return this.cli(["variables", "delete", name, "--project-level", "--force", "--json"]);
  }

  /** The providers the platform has registered. */
  registeredIdps(): Promise<RegisteredIdp[]> {
    return this.listed<RegisteredIdp>("idps");
  }

  publishedSchemas(): Promise<PublishedSchema[]> {
    return this.listed<PublishedSchema>("schemas");
  }

  /** The one schema a scaffolded project publishes. */
  async publishedSchema(): Promise<PublishedSchema> {
    return only(await this.publishedSchemas(), "schema");
  }

  publishedFlows(): Promise<PublishedFlow[]> {
    return this.listed<PublishedFlow>("flow-definitions");
  }

  /** The one login flow a scaffolded project publishes. */
  async publishedFlow(): Promise<PublishedFlow> {
    return only(await this.publishedFlows(), "flow definition");
  }

  /**
   * The variables entered on the project itself. Owners are separate rather
   * than a ladder, so this is the project's own set and not a merge of
   * anything an environment holds.
   */
  async projectVariables(): Promise<ProjectVariable[]> {
    const result = await this.cli(["variables", "list", "--project-level", "--json"]);
    expect(result, "variables list should have succeeded").toSucceed();
    return this.envelopeOf<{ variables: ProjectVariable[] }>(result).data.variables;
  }

  /**
   * The published steps a sign-in can start from with a provider offered.
   *
   * Non-empty only: the meta-schema defaults `sso_providers` to `[]`, so the
   * key's presence says nothing.
   */
  async stepsOfferingSso(): Promise<FlowStep[]> {
    const { flow_definition } = await this.publishedFlow();
    return flow_definition.steps.filter((step) => (step.sso_providers ?? []).length > 0);
  }

  /** What the fake npm was asked to do, for the install leg of setup. */
  async installInvocation(): Promise<{ cwd: string; args: string[] }> {
    if (this.installLogPath === undefined) {
      throw new Error("setup was not run with { install: true }");
    }
    return JSON.parse((await readFile(this.installLogPath, "utf8")).trim()) as {
      cwd: string;
      args: string[];
    };
  }

  envelopeOf<T = Record<string, unknown>>(result: CliResult): Envelope<T> {
    try {
      return parseJson(result.stdout) as Envelope<T>;
    } catch {
      throw new Error(`expected a JSON envelope on stdout, got: ${result.stdout || "(empty)"}`);
    }
  }

  /**
   * Records the project's files so a later `changesSince` can say what a
   * command touched, without a spec reading any content.
   */
  snapshot(): Promise<ProjectSnapshot> {
    return ProjectSnapshot.of(this.path);
  }

  /**
   * Every file in the project whose text contains this string.
   *
   * The credential checks need the whole tree, not the documents a journey
   * happens to name: a secret written into `.env.local`, a scaffolded page or
   * `zitadel.json` is just as committed as one in the connection.
   */
  async filesContaining(text: string): Promise<string[]> {
    const found: string[] = [];
    for (const relativePath of (await ProjectSnapshot.of(this.path)).paths()) {
      const contents = await readFile(join(this.path, relativePath), "utf8");
      if (contents.includes(text)) {
        found.push(relativePath);
      }
    }
    return found.sort();
  }

  readProjectFile(relativePath: string): Promise<string> {
    return readFile(join(this.path, relativePath), "utf8");
  }

  writeProjectFile(relativePath: string, contents: string): Promise<void> {
    return writeFile(join(this.path, relativePath), contents);
  }

  /** Leaves `version` of `name` in the app's `node_modules`, as its lockfile installed it. */
  async hasInstalled(name: string, version: string): Promise<void> {
    await mkdir(join(this.path, "node_modules", name), { recursive: true });
    await this.writeProjectFile(
      `node_modules/${name}/package.json`,
      JSON.stringify({ name, version }),
    );
  }

  deleteProjectFile(relativePath: string): Promise<void> {
    return rm(join(this.path, relativePath));
  }

  async hasProjectFile(relativePath: string): Promise<boolean> {
    try {
      await stat(join(this.path, relativePath));
      return true;
    } catch {
      return false;
    }
  }

  /** Edits the committed user schema, as the developer owning it would. */
  editUserSchema(edit: (schema: UserSchemaDocument) => void): Promise<void> {
    return this.editDocument(SCHEMA_FILE, edit);
  }

  /** Edits the password step of the committed login flow, as the developer owning it would. */
  editPasswordStep(edit: (step: FlowDocument["steps"][number]) => void): Promise<void> {
    return this.editLoginFlow((flow) => {
      const step = flow.steps.find((candidate) => candidate.name === "password");
      if (step === undefined) {
        throw new Error("the login flow has no password step");
      }
      edit(step);
    });
  }

  /** Edits a committed connection file, as the developer owning it would. */
  editConnection(slug: string, edit: (connection: ConnectionDocument) => void): Promise<void> {
    return this.editDocument(`.zitadel/idps/${slug}.json`, edit);
  }

  /** Adds a second connection file that claims the same slug as an existing one. */
  async copyConnection(slug: string, name: string): Promise<void> {
    await this.writeProjectFile(
      `.zitadel/idps/${name}.json`,
      await this.readProjectFile(`.zitadel/idps/${slug}.json`),
    );
  }

  /** A connection file as it is on disk. */
  async connectionOf(slug: string): Promise<ConnectionDocument> {
    return JSON.parse(
      await this.readProjectFile(`.zitadel/idps/${slug}.json`),
    ) as ConnectionDocument;
  }

  /** The project-relative path of a connection's file, as a command reports it. */
  connectionFile(slug: string): string {
    return `.zitadel/idps/${slug}.json`;
  }

  /** Adds a connection no schema lists, so removing it breaks nothing else. */
  async addUnlistedConnection(slug: string): Promise<void> {
    const prefix = slug.toUpperCase().replaceAll("-", "_");
    await this.copyConnection("google", slug);
    await this.editConnection(slug, (connection) => {
      connection.slug = slug;
      connection.oidc.client_id = `\${{ ${prefix}_CLIENT_ID }}`;
      connection.oidc.client_secret = `\${{ ${prefix}_CLIENT_SECRET }}`;
    });
    await this.setVariable(`${prefix}_CLIENT_ID`, "a-client-id");
    await this.setVariable(`${prefix}_CLIENT_SECRET`, "a-client-secret", { secret: true });
  }

  /** Removes a committed connection file, as the developer owning it would. */
  removeConnection(slug: string): Promise<void> {
    return this.deleteProjectFile(`.zitadel/idps/${slug}.json`);
  }

  /** Renames a committed connection file without touching its contents. */
  async renameConnection(slug: string, name: string): Promise<void> {
    await this.copyConnection(slug, name);
    await this.removeConnection(slug);
  }

  /** Edits the committed login flow, as the developer owning it would. */
  editLoginFlow(edit: (flow: FlowDocument) => void): Promise<void> {
    return this.editDocument(FLOW_FILE, edit);
  }

  editPackageJson(edit: (pkg: PackageJson) => void): Promise<void> {
    return this.editDocument("package.json", edit);
  }

  /** Adds a second flow definition, for a spec whose input is the flow itself. */
  addFlow(name: string, definition: unknown): Promise<void> {
    return this.writeProjectFile(
      `.zitadel/flows/${name}.json`,
      `${JSON.stringify(definition, null, 2)}\n`,
    );
  }

  /** Whether the project has been set up, which `zitadel.json` records. */
  hasBeenConfigured(): Promise<boolean> {
    return this.hasProjectFile("zitadel.json");
  }

  /** Writes `zitadel.json`, for a spec arranging a particular configuration. */
  writeConfig(config: Record<string, unknown>): Promise<void> {
    return this.writeProjectFile("zitadel.json", JSON.stringify(config, null, 2));
  }

  /** Writes the local secret a configured project carries. */
  async writeLocalSecret(projectId: string): Promise<void> {
    await mkdir(join(this.path, ".zitadel"), { recursive: true });
    await this.writeProjectFile(
      ".zitadel/secret",
      JSON.stringify({
        project_id: projectId,
        project_secret: "sk",
        preview_secret: "sk",
        primary_origins: [],
        preview_origins: [],
        created_at: "2026-01-01T00:00:00.000Z",
      }),
    );
  }

  private async editDocument<T>(relativePath: string, edit: (document: T) => void): Promise<void> {
    const contents = await readFile(join(this.path, relativePath), "utf8");
    const document = JSON.parse(contents) as T;
    edit(document);
    await writeFile(join(this.path, relativePath), `${JSON.stringify(document, null, 2)}\n`);
  }

  private installLogPath: string | undefined;

  private async listed<T>(topic: string): Promise<T[]> {
    const result = await this.cli([topic, "list", "--json"]);
    expect(result, `${topic} list should have succeeded`).toSucceed();
    return this.envelopeOf<{ items: T[] }>(result).data.items;
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

  private pipingSecret<T>(secret: string, run: () => Promise<T>): Promise<T> {
    return this.pipingStdin(secret, run);
  }

  /** Runs with a terminal on stdin, so a read would never end and has to be refused. */
  private async withKeyboardOnStdin<T>(run: () => Promise<T>): Promise<T> {
    const original = Object.getOwnPropertyDescriptor(process, "stdin");
    Object.defineProperty(process, "stdin", { value: { isTTY: true }, configurable: true });
    try {
      return await run();
    } finally {
      if (original) {
        Object.defineProperty(process, "stdin", original);
      }
    }
  }

  /**
   * `runCliForTest` runs in-process, so a scripted run would otherwise read
   * the test runner's own stdin and block on a stream that never ends.
   */
  private async pipingStdin<T>(text: string, run: () => Promise<T>): Promise<T> {
    const original = Object.getOwnPropertyDescriptor(process, "stdin");
    Object.defineProperty(process, "stdin", {
      value: Readable.from([text]),
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

/** The project's files and their hashes at a moment in time. */
export class ProjectSnapshot {
  private readonly root: string;
  private readonly files: Map<string, string>;

  private constructor(root: string, files: Map<string, string>) {
    this.root = root;
    this.files = files;
  }

  static async of(root: string): Promise<ProjectSnapshot> {
    return new ProjectSnapshot(root, await hashTree(root));
  }

  /** Every file the project held when this was taken. */
  paths(): string[] {
    return [...this.files.keys()].sort();
  }

  /** What has been added, modified, removed or left alone since. */
  async changes(): Promise<ProjectChanges> {
    const now = await hashTree(this.root);
    const added: string[] = [];
    const modified: string[] = [];
    const removed: string[] = [];
    const unchanged: string[] = [];

    for (const [path, hash] of now) {
      const before = this.files.get(path);
      if (before === undefined) added.push(path);
      else if (before === hash) unchanged.push(path);
      else modified.push(path);
    }
    for (const path of this.files.keys()) {
      if (!now.has(path)) removed.push(path);
    }

    return {
      added: added.sort(),
      modified: modified.sort(),
      removed: removed.sort(),
      unchanged: unchanged.sort(),
    };
  }
}

async function hashTree(root: string, prefix = ""): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      for (const [nested, hash] of await hashTree(root, path)) files.set(nested, hash);
    } else if (entry.isFile()) {
      const contents = await readFile(join(root, path));
      files.set(path, createHash("sha256").update(contents).digest("hex"));
    }
  }
  return files;
}

function only<T>(items: T[], what: string): T {
  if (items.length !== 1) {
    throw new Error(`expected exactly one ${what} on the platform, found ${items.length}`);
  }
  return items[0] as T;
}

/**
 * The envelope contract, checked on every `--json` invocation a spec makes.
 *
 * It lives here rather than in a suite of its own because a dedicated contract
 * file only covers the commands somebody remembered to list, while this covers
 * every command any spec runs, and fails in the spec of the command that broke.
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
  if (envelope.status === "error") {
    expect(envelope.code, `${where}: error envelope carries no code`).toBeTypeOf("string");
  }
}

/**
 * A minimal app in a temp directory, the pre-existing-app posture setup
 * scaffolds into. The dir is left under the OS temp dir rather than deleted on
 * teardown: CI runners are ephemeral and the OS reclaims `tmpdir()` entries, so
 * skipping the recursive delete avoids the transient ENOTEMPTY/EBUSY race it can
 * hit on a busy filesystem (the CLI awaits every write, so nothing is in flight).
 */
export async function anApp({
  nextVersion = "^16.0.0",
}: {
  nextVersion?: string;
} = {}): Promise<ScaffoldedApp> {
  const path = await mkdtemp(join(tmpdir(), "zitadel-next-"));

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

/**
 * An empty directory for setup to create a new app in, under a name npm
 * accepts for a package, which setup requires of one.
 */
export async function aNewAppDirectory(): Promise<ScaffoldedApp> {
  const parent = await mkdtemp(join(tmpdir(), "zitadel-new-"));
  const path = join(parent, "my-app");
  await mkdir(path);
  return new ScaffoldedApp(path);
}

/** An app already through `setup`, for specs about the commands after it. */
export async function aSetUpApp(extraArgs: string[] = []): Promise<ScaffoldedApp> {
  const app = await anApp();
  const result = await app.setup(extraArgs);
  expect(result, "arranging setup should have succeeded").toSucceed();
  return app;
}

/** A fake `npm` on PATH that records its invocation instead of installing. */
async function fakePackageManager(): Promise<{ binDir: string; logPath: string }> {
  const binDir = await mkdtemp(join(tmpdir(), "zitadel-fake-pm-"));
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

/** A fake `docker` on PATH, so doctor's runtime probe needs no daemon. */
async function fakeDocker(): Promise<{ binDir: string; logPath: string }> {
  const binDir = await mkdtemp(join(tmpdir(), "zitadel-fake-docker-"));
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
