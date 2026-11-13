import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { parseEnv, promisify } from "node:util";

import { snapshotPlatformStore } from "@zitadel/api-mock/platform";
import { expect, vi } from "vitest";
import { z } from "zod";

import { aFakeAppGeneratorPath } from "./app-generator";
import { aFakeServerBinary, trackLocalServerDir, type ServerShape } from "./local-server";
import { parseJsonOrUndefined } from "@/lib/json";
import type { JsonObject } from "@/lib/zitadel/types";
import { toJsonObject } from "@/lib/zitadel/utils/json";
import { cliPackageRoot } from "./oclif-build";
import { nextPort } from "./ports";

/** How long a run gets to unwind after an interrupt before the test gives up on it. */
const INTERRUPT_GRACE_MS = 10_000;

/**
 * What an interrupted run ended as: an exit code when it unwound through its
 * own error path, or the signal that killed it when it never got that far.
 */
export type InterruptedRun = Readonly<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}>;
import { aBinaryRecord } from "./runtime-record";
import { parseJson, pressCtrlC, runCliForTest, stripAnsi } from "./run-cli";
import { asTerminal, offTerminal, onTerminalReadingAFile } from "./terminal";
import { assertRunnableSuggestions } from "./suggestions";

const execFileAsync = promisify(execFile);

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

/**
 * A non-interactive `deploy` outside a git repository, as `aSetUpApp` arranges,
 * needs a `-m` message, so the helpers default one unless the spec supplied its own.
 */
function withDeployMessage(extraArgs: readonly string[]): string[] {
  const hasMessage = extraArgs.some((arg) => arg === "-m" || arg === "--message");
  return hasMessage ? [...extraArgs] : ["-m", "test deploy", ...extraArgs];
}

/** The data a `deploy` envelope carries, for a deploy expected to succeed. */
export interface DeployResult {
  readonly content_hash?: string;
  readonly release_id?: string;
  readonly deployment_id?: string;
  readonly resources?: number;
  readonly origins?: string[];
  readonly dry_run?: boolean;
  readonly diff?: {
    readonly against: string | null;
    readonly files: ReadonlyArray<{
      readonly path: string;
      readonly status: string;
      readonly previous_path?: string;
      readonly patch: string;
    }> | null;
    readonly note?: string;
  };
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

export interface ProjectOrigin {
  readonly pattern: string;
  readonly kind: string;
}

/**
 * The origin `zitadel setup` registers for the app it scaffolds: the development
 * server, as a primary pattern, because only a primary one admits the app's own
 * requests. A fresh project already holds it.
 */
export const SETUP_ORIGIN: ProjectOrigin = { pattern: "http://localhost:3000", kind: "primary" };

export interface RegisteredIdp {
  readonly id: string;
  readonly slug: string;
}

export interface PublishedPolicy {
  readonly id: string;
  readonly operation: string;
  readonly revision_id: string;
  readonly config: Readonly<Record<string, number | string>>;
}

/** The operation the password policy guards, and its file's name. */
export const PASSWORD_POLICY = "auth.factor.password.set";

/** The sign-up policy `setup` publishes beside it: the default, the built-in proof of work. */
export const DEFAULT_SIGNUP_POLICY = {
  operation: "user.create",
  config: { challenge: "zitadel_pow" },
};

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
  required?: string[];
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

/** The checks behind {@link UserSchemaDocument}, run before a spec edits one. */
const UserSchemaDocumentSchema: z.ZodType<UserSchemaDocument> = z.object({
  properties: z.record(z.string(), z.unknown()),
  required: z.array(z.string()).optional(),
  "x-auth-methods": z
    .record(
      z.string(),
      z.object({
        enabled: z.boolean(),
        providers: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

/** The checks behind {@link ConnectionDocument}, run before a spec edits one. */
const ConnectionDocumentSchema: z.ZodType<ConnectionDocument> = z.object({
  slug: z.string(),
  protocol: z.string().optional(),
  display_name: z.string().optional(),
  subject_claim: z.string().optional(),
  oidc: z.object({
    issuer: z.string(),
    client_id: z.string().optional(),
    client_secret: z.string().optional(),
  }),
  claim_mapping: z.record(z.string(), z.string()).optional(),
  verified_claims: z.record(z.string(), z.string()).optional(),
});

/** The checks behind {@link FlowDocument}, run before a spec edits one. */
const FlowDocumentSchema: z.ZodType<FlowDocument> = z.object({
  purposes: z.record(z.string(), z.string()),
  steps: z.array(
    z.object({
      name: z.string(),
      fields: z.array(z.string()).optional(),
      actions: z
        .array(
          z.object({
            name: z.string(),
            text_key: z.string().optional(),
          }),
        )
        .optional(),
      transitions: z.record(z.string(), z.unknown()).optional(),
      sso_providers: z.array(z.string()).optional(),
    }),
  ),
});

/** The checks behind {@link PackageJson}, run before a spec edits one. */
const PackageJsonSchema: z.ZodType<PackageJson> = z.object({
  dependencies: z.record(z.string(), z.string()),
});

/** The origins `.zitadel/secret` records, which a spec rewrites. */
const SecretOriginsSchema = z.object({
  primary_origins: z.array(z.string()).optional(),
  preview_origins: z.array(z.string()).optional(),
});

/** Any JSON object, for an edit that only adds or removes a key. */
const AnyObjectSchema = z.record(z.string(), z.unknown());

/** A committed connection's credentials, as a spec reads them back. */
const CommittedIdpConnection = z.looseObject({
  oidc: z.looseObject({
    client_id: z.string(),
    client_secret: z.string(),
  }),
});

/** What the fake `npx` records of how `upgrade` ran it. */
const RefreshLog = z.looseObject({
  args: z.array(z.string()),
});

/** What the fake npm records of how setup ran it. */
const InstallLog = z.looseObject({
  cwd: z.string(),
  args: z.array(z.string()),
});

/** The project values `.zitadel/secret` holds, as far as an environment binding reads them. */
const ProjectSecret = z.looseObject({
  project_id: z.string(),
  project_secret: z.string(),
  preview_secret: z.string(),
});

/** The recovery a failed `doctor` run offers, at the envelope's root. */
const DoctorRecovery = z.looseObject({
  details: z
    .looseObject({
      suggested_args: z.array(z.array(z.string())).optional(),
    })
    .optional(),
});

/**
 * Whether a value passes `schema`'s checks, as a guard over the value itself
 * rather than the copy `parse` makes, so an edit lands on the document as read
 * and its keys keep their order. Sound only for a schema with no transforms or
 * defaults, which none of the schemas here has.
 *
 * @param schema - The checks the value must pass.
 * @param value - The value read.
 * @returns Whether it is a `T`.
 */
function conforms<T>(schema: z.ZodType<T>, value: unknown): value is T {
  return schema.safeParse(value).success;
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

  /**
   * A committed connection's credentials, as the file spells them.
   *
   * @param slug - The connection's slug, which names its file.
   * @returns The connection, its `oidc` credentials checked to be strings.
   */
  async idpConnection(
    slug: string,
  ): Promise<{ oidc: { client_id: string; client_secret: string } }> {
    return CommittedIdpConnection.parse(await this.read(`.zitadel/idps/${slug}.json`));
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

  /**
   * A committed JSON document.
   *
   * @param relativePath - The file, from the project's root.
   * @returns Its contents, checked to be a JSON object.
   */
  private async read(relativePath: string): Promise<JsonObject> {
    return toJsonObject(
      JSON.parse(await readFile(join(this.root, relativePath), "utf8")),
      relativePath,
    );
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
/**
 * The identity the developer committed with, as `git -c` gives it: setup commits
 * as the developer on every machine, a CI runner with no git identity included.
 */
const DEVELOPER_GIT = {
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "user.name",
  GIT_CONFIG_VALUE_0: "Dev",
  GIT_CONFIG_KEY_1: "user.email",
  GIT_CONFIG_VALUE_1: "dev@example.com",
};

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
    env: NodeJS.ProcessEnv = {},
  ): Promise<CliResult> {
    if (!install) {
      return this.cli(["setup", "--non-interactive", "--json", "--skip-install", ...extraArgs], {
        ...DEVELOPER_GIT,
        ...env,
      });
    }
    const npm = await fakePackageManager();
    this.installLogPath = npm.logPath;
    return this.cli(["setup", "--non-interactive", "--json", ...extraArgs], {
      ...DEVELOPER_GIT,
      PACKAGE_MANAGER_LOG: npm.logPath,
      PATH: `${npm.binDir}:${process.env.PATH ?? ""}`,
    });
  }

  /**
   * Runs `tests add`, with a fake npm on `PATH` that records the install when
   * `install` is set, and `--skip-install` otherwise.
   */
  async addTests(
    extraArgs: string[] = [],
    { install = false }: { install?: boolean } = {},
    env: NodeJS.ProcessEnv = {},
  ): Promise<CliResult> {
    if (!install) {
      return this.cli(["tests", "add", "--skip-install", ...extraArgs], env);
    }
    const npm = await fakePackageManager();
    this.installLogPath = npm.logPath;
    return this.cli(["tests", "add", ...extraArgs], {
      PACKAGE_MANAGER_LOG: npm.logPath,
      PATH: `${npm.binDir}:${process.env.PATH ?? ""}`,
      ...env,
    });
  }

  /**
   * Runs setup with a git that does everything but commit, as a full disk or a
   * broken git would: setup creates the repository and then cannot commit.
   */
  async setupWithGitThatCannotCommit(): Promise<CliResult> {
    const git = await gitThatCannotCommit();
    return this.cli(["setup", "--non-interactive", "--json", "--skip-install"], {
      PATH: `${git}:${process.env.PATH ?? ""}`,
    });
  }

  /**
   * Puts the app under version control with everything committed, the state a
   * developer who already uses git is in before they run setup.
   */
  async underVersionControl(): Promise<void> {
    await execFileAsync("git", ["init", "--quiet"], { cwd: this.path });
    await execFileAsync("git", ["add", "--all"], { cwd: this.path });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Dev",
        "-c",
        "user.email=dev@example.com",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--quiet",
        "--no-verify",
        "--message=feat: the developer's own work",
      ],
      { cwd: this.path },
    );
  }

  /** Detaches HEAD from its branch, as a checkout of a tag or a CI job's checkout does. */
  async onADetachedHead(): Promise<void> {
    await execFileAsync("git", ["checkout", "--quiet", "--detach"], { cwd: this.path });
  }

  /** Leaves a file nobody has committed, as a developer mid-change would. */
  async withUncommittedWork(): Promise<void> {
    await writeFile(join(this.path, "notes.md"), "a note to self\n");
  }

  /**
   * The paths setup's commit put under version control. Read from git because
   * that is the behaviour: a secret that reaches version control cannot be
   * scrubbed later, so what is tracked is the claim being made.
   */
  async trackedFiles(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["-c", "core.quotePath=false", "ls-files", "-z"],
        { cwd: this.path },
      );
      return stdout.split("\0").filter((line) => line !== "");
    } catch {
      return [];
    }
  }

  /** Commits everything outstanding, as the developer would before deploying. */
  async commitEverything(): Promise<void> {
    await execFileAsync("git", ["add", "--all"], { cwd: this.path });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Dev",
        "-c",
        "user.email=dev@example.com",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--quiet",
        "--no-verify",
        "--message=feat: change the configuration",
      ],
      { cwd: this.path },
    );
  }

  /** The subjects of the project's commits, newest first, or [] without a repo. */
  async commitSubjects(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync("git", ["log", "--format=%s"], { cwd: this.path });
      return stdout.split("\n").filter((line) => line !== "");
    } catch {
      return [];
    }
  }

  /** `setup` without `--json`, for a spec asserting what the developer reads. */
  setupRendered(extraArgs: string[] = [], env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
    return this.cli(["setup", "--non-interactive", "--skip-install", ...extraArgs], {
      ...DEVELOPER_GIT,
      ...env,
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
      {
        ...DEVELOPER_GIT,
        PATH: await aFakeAppGeneratorPath(),
      },
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
  async doctor(extraArgs: string[] = [], env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
    const docker = await fakeDocker();
    return this.cli(["doctor", "--json", ...extraArgs, "--port", String(nextPort())], {
      PATH: `${docker.binDir}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: docker.logPath,
      ...env,
    });
  }

  /** Runs `doctor` with the update check on, which the suite otherwise keeps off. */
  async doctorLookingForUpdates(): Promise<CliResult> {
    const docker = await fakeDocker();
    return this.cli(["doctor", "--json", "--port", String(nextPort())], {
      PATH: `${docker.binDir}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: docker.logPath,
      ZITADEL_UPDATE_CHECK: "",
      XDG_CONFIG_HOME: docker.binDir,
    });
  }

  /** Runs `doctor` for a person, against a fake docker on PATH. */
  async doctorRendered(extraArgs: string[] = [], env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
    const docker = await fakeDocker();
    return this.cli(["doctor", ...extraArgs, "--port", String(nextPort())], {
      PATH: `${docker.binDir}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: docker.logPath,
      ...env,
    });
  }

  /** Runs `upgrade --json` against a fake npm and npx on PATH. */
  upgrade(
    extraArgs: string[] = [],
    behavior: UpgradeBehavior = {},
    env: NodeJS.ProcessEnv = {},
  ): Promise<CliResult> {
    return this.upgradeWith(["--json", ...extraArgs], behavior, env);
  }

  /**
   * `upgrade --json` with Ctrl-C pressed once its install or its refresh is
   * running, against fakes slow enough to still be running when it is.
   *
   * @param during - Which of the two the keypress lands in.
   * @returns What the interrupted run ended with.
   */
  async upgradeInterrupted(during: "install" | "refresh"): Promise<CliResult> {
    const running = this.upgrade(
      [],
      during === "install" ? { install: "slow" } : { refresh: "slow" },
    );
    await vi.waitFor(
      async () => {
        const started = during === "install" ? this.installLogPath : this.refreshLogPath;
        if (started === undefined) {
          throw new Error("upgrade has not reached the fakes");
        }
        await stat(started);
      },
      { timeout: 30_000 },
    );
    pressCtrlC();
    return running;
  }

  /**
   * `claim --json` with Ctrl-C pressed once it is waiting on the browser step,
   * which it is when the platform holds the challenge it opened.
   *
   * @returns What the interrupted run ended with.
   */
  async claimInterrupted(): Promise<CliResult> {
    const running = this.cli(["claim", "--no-open", "--timeout", "30", "--json"]);
    await vi.waitFor(
      () => {
        if (snapshotPlatformStore().claimChallengeIds.length === 0) {
          throw new Error("claim has not opened a challenge");
        }
      },
      { timeout: 30_000 },
    );
    pressCtrlC();
    return running;
  }

  /** Runs `upgrade` for a person, against the same fakes. */
  upgradeRendered(env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
    return this.upgradeWith([], {}, env);
  }

  /** The arguments `upgrade` gave npx to refresh the generated files. */
  async refreshInvocation(): Promise<string[]> {
    if (this.refreshLogPath === undefined) {
      throw new Error("upgrade was not run");
    }
    return RefreshLog.parse(JSON.parse((await readFile(this.refreshLogPath, "utf8")).trim())).args;
  }

  /** Whether the fake npm was asked for anything. */
  async installWasRun(): Promise<boolean> {
    if (this.installLogPath === undefined) {
      throw new Error("upgrade was not run");
    }
    return readFile(this.installLogPath, "utf8").then(
      () => true,
      () => false,
    );
  }

  private async upgradeWith(
    args: string[],
    behavior: UpgradeBehavior,
    env: NodeJS.ProcessEnv = {},
  ): Promise<CliResult> {
    const npm = await fakePackageManager(
      behavior.install === "fails" ? 1 : 0,
      behavior.install === "slow",
    );
    const npx = await fakeNpx(behavior.refresh ?? "done");
    this.installLogPath = npm.logPath;
    this.refreshLogPath = npx.logPath;
    return this.cli(["upgrade", ...args], {
      PACKAGE_MANAGER_LOG: npm.logPath,
      FAKE_NPX_LOG: npx.logPath,
      PATH: `${npx.binDir}:${npm.binDir}:${process.env.PATH ?? ""}`,
      // The lookup keeps its answer in the home; a run's must not reach the next.
      XDG_CONFIG_HOME: npm.binDir,
      ...env,
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

  /**
   * The port a `doctor` run reported it checked, whether it passed (in `data`)
   * or found issues (in the error's `details`).
   *
   * @param result - The `doctor --json` run.
   * @returns The port.
   */
  doctoredPortOf(result: CliResult): number {
    const envelope = this.envelopeOf(result) as Readonly<{
      data?: Readonly<{ port: number }>;
      details?: Readonly<{ port: number }>;
    }>;
    const port = envelope.data?.port ?? envelope.details?.port;
    if (port === undefined) {
      throw new Error(`expected doctor to report its port, got: ${result.stdout}`);
    }

    return port;
  }

  /**
   * The argument lists a failed `doctor` run offered as recovery, for an agent
   * to run as they are.
   *
   * @param result - The `doctor --json` run.
   * @returns Each suggested argument list, or none.
   */
  suggestedArgsOf(result: CliResult): string[][] {
    const { details } = DoctorRecovery.parse(this.envelopeOf(result));
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
    json = true,
  }: {
    shape?: ServerShape;
    port?: number;
    json?: boolean;
  } = {}): Promise<CliResult> {
    trackLocalServerDir(this.path);
    return this.cli(["start", "--port", String(port), ...(json ? ["--json"] : [])], {
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

  /**
   * `status` run as its own process against a server that accepts the
   * connection and never answers.
   *
   * @remarks
   * Its own process, because the in-process runner cannot see the thing this
   * measures: the presence probe answers "unknown" on a deadline, and a
   * request still in flight after that holds a real process open until the
   * client's own timeout. Only a spawned run exits when the request is
   * actually given up on.
   *
   * @returns The run, and how long the process took to exit.
   */
  async statusAgainstAStalledServer(): Promise<{
    result: CliResult;
    elapsedMs: number;
  }> {
    const stalled = createServer(() => {
      // Accepted and never answered, which is the case a deadline is for.
    });
    const port = nextPort();
    await new Promise<void>((listening) => {
      stalled.listen(port, "127.0.0.1", listening);
    });
    const startedAt = Date.now();
    try {
      const result = await new Promise<CliResult>((resolve) => {
        execFile(
          process.execPath,
          [
            join(cliPackageRoot, "bin/run.js"),
            ...["status", "--json", "--cwd", this.path],
            ...["--server", `http://127.0.0.1:${String(port)}`],
          ],
          {
            env: {
              ...process.env,
              DO_NOT_TRACK: "1",
            },
          },
          (error, stdout, stderr) => {
            return resolve({
              exitCode: typeof error?.code === "number" ? error.code : 0,
              stdout,
              stderr,
            });
          },
        );
      });
      return {
        result,
        elapsedMs: Date.now() - startedAt,
      };
    } finally {
      stalled.closeAllConnections();
      await new Promise<void>((closed) => {
        stalled.close(() => {
          return closed();
        });
      });
    }
  }

  /**
   * Run `status` against a server that never answers and interrupt it, as a
   * person pressing Ctrl-C does.
   *
   * @remarks
   * Spawned rather than run in process, because an interrupt is delivered to a
   * process and a command that keeps running after one is only visible from
   * outside. The probe is the only request in flight, so the signal reaches it
   * and nothing else.
   *
   * @returns What the run exited with, and the signal that killed it instead.
   */
  async statusInterrupted(): Promise<InterruptedRun> {
    // The probe's own request is what says the run has got far enough to be
    // interrupted: a timer would either fire while the CLI was still booting,
    // when the interrupt kills it outright, or after the probe's deadline.
    const reached = { interrupt: (): void => {} };
    const stalled = createServer(() => {
      // Accepted and never answered, so the probe is still in flight.
      reached.interrupt();
    });
    const port = nextPort();
    await new Promise<void>((listening) => {
      stalled.listen(port, "127.0.0.1", listening);
    });
    try {
      return await new Promise<InterruptedRun>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            join(cliPackageRoot, "bin/run.js"),
            ...["status", "--json", "--cwd", this.path],
            ...["--server", `http://127.0.0.1:${String(port)}`],
          ],
          {
            env: {
              ...process.env,
              DO_NOT_TRACK: "1",
            },
          },
        );
        const out: string[] = [];
        const err: string[] = [];
        child.stdout.on("data", (chunk: Buffer) => {
          out.push(chunk.toString());
        });
        child.stderr.on("data", (chunk: Buffer) => {
          err.push(chunk.toString());
        });
        reached.interrupt = () => {
          child.kill("SIGINT");
        };
        // A run that neither unwinds nor dies would otherwise hold the suite
        // until its own deadline, and the failure would read as a timeout
        // somewhere else rather than as a command that ignored the interrupt.
        const gaveUp = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`status kept running ${String(INTERRUPT_GRACE_MS)}ms after SIGINT`));
        }, INTERRUPT_GRACE_MS);
        child.on("close", (code, signal) => {
          clearTimeout(gaveUp);
          // A run the signal killed outright never installed its handler, which
          // is a different failure from one that unwound: it answers no exit
          // code and names the signal instead, so neither reads as the other.
          const run = {
            exitCode: code,
            signal,
            stdout: out.join(""),
            stderr: err.join(""),
          };
          assertNothingDrivesTheTerminal(run, ["status"]);
          return resolve(run);
        });
      });
    } finally {
      stalled.closeAllConnections();
      await new Promise<void>((closed) => {
        stalled.close(() => {
          return closed();
        });
      });
    }
  }

  /** Add a primary origin, so a deploy to `primary` has somewhere to land. */
  async addPrimaryOrigin(pattern = "https://app.example.com"): Promise<void> {
    const result = await this.cli([
      "origin",
      "add",
      pattern,
      "--kind",
      "primary",
      "--non-interactive",
      "--json",
    ]);
    expect(result, "origin add should have succeeded").toSucceed();
  }

  /** How many deployments the project serves, as `deployment list` reports them. */
  async liveDeploymentCount(): Promise<number> {
    const result = await this.cli(["deployment", "list", "--json"]);
    expect(result, "deployment list should have succeeded").toSucceed();
    return this.envelopeOf<{ count: number }>(result).data.count;
  }

  /** The message a release records, as `release get` reports it. */
  async releaseMessage(releaseId: string): Promise<string | null> {
    const result = await this.cli(["release", "get", releaseId, "--json"]);
    expect(result, "release get should have succeeded").toSucceed();
    return this.envelopeOf<{ metadata: { message: string | null } }>(result).data.metadata.message;
  }

  /** The message a deployment records, as `deployment get` reports it. */
  async deploymentMessage(deploymentId: string): Promise<string | null> {
    const result = await this.cli(["deployment", "get", deploymentId, "--json"]);
    expect(result, "deployment get should have succeeded").toSucceed();
    return this.envelopeOf<{ metadata: { message: string | null } }>(result).data.metadata.message;
  }

  /** Build a release from `.zitadel/` and deploy it to every primary origin. */
  deploy(extraArgs: string[] = []): Promise<CliResult> {
    return this.cli(["deploy", "--non-interactive", "--json", ...withDeployMessage(extraArgs)]);
  }

  /**
   * What `apply` was for a set-up project: gives it the primary origin a deploy
   * needs, then deploys.
   */
  async publish(): Promise<CliResult> {
    await this.addPrimaryOrigin();
    return this.deploy();
  }

  /** {@link publish}, failing the arrange if the deploy does not succeed. */
  async publishData(): Promise<DeployResult> {
    await this.addPrimaryOrigin();
    return this.deployData();
  }

  /** The envelope data of a deploy expected to succeed (its content digest). */
  async deployData(extraArgs: string[] = []): Promise<DeployResult> {
    const result = await this.deploy(extraArgs);
    expect(result, "deploy should have succeeded").toSucceed();
    return this.envelopeOf<DeployResult>(result).data;
  }

  /** Deploys a preview to `url` and returns its envelope data, failing the arrange if it does not. */
  async previewData(url: string): Promise<Record<string, unknown>> {
    const result = await this.run(["preview", "--origin", url, "--json"]);
    expect(result, "preview should have succeeded").toSucceed();
    return this.envelopeOf<Record<string, unknown>>(result).data;
  }

  /** `deploy --dry-run`: validates and shows the diff without writing. */
  deployDryRun(extraArgs: string[] = []): Promise<CliResult> {
    return this.cli(["deploy", "--dry-run", "--non-interactive", "--json", ...extraArgs]);
  }

  /** The envelope data of a dry run expected to succeed (its diff). */
  async deployDryRunData(extraArgs: string[] = []): Promise<DeployResult> {
    const result = await this.deployDryRun(extraArgs);
    expect(result, "deploy --dry-run should have succeeded").toSucceed();
    return this.envelopeOf<DeployResult>(result).data;
  }

  /**
   * Commits the whole app to git, making it a repository the first time, as a
   * developer does before they deploy: a deploy records the commit it was built
   * from, and the next one diffs `.zitadel/` against it.
   */
  async commit(): Promise<void> {
    const git = (args: string[]) => promisify(execFile)("git", args, { cwd: this.path });
    await git(["init", "-q"]);
    await git(["add", "-A"]);
    await git([
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "wip",
    ]);
  }

  /** `deploy` without `--json`, for a spec asserting what the developer reads. */
  deployRendered(extraArgs: string[] = []): Promise<CliResult> {
    return this.cli(["deploy", "--non-interactive", ...withDeployMessage(extraArgs)]);
  }

  run(args: string[], env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
    return this.cli(args, env);
  }

  /**
   * The same run in each way a reader sees it, held to the fixture's invariants
   * in every one: as a script reads it, piped, and on a terminal in colour and
   * without.
   *
   * @remarks
   * A command says what it says in three renderings, and the invariant — that
   * nothing printed drives the reader's terminal, and that a JSON body parses —
   * has to hold in all of them. Every escaping fix before this was the same
   * invariant broken at one more site, because a command's spec exercised the
   * one rendering it happened to use, which was almost always `--json`.
   *
   * It asserts no outcome of its own: `cli` holds every run to the invariants
   * already, and this is what puts them to each rendering. A command run more
   * than once may refuse the later runs — an origin already added, a release
   * already built — and a refusal is a rendering too, which is where this broke
   * first.
   *
   * `run` is given how to run, so a command needing a fake on `PATH` or a port
   * of its own passes its own runner and keeps that knowledge in its own spec.
   *
   * @param run - Runs the command for one rendering.
   */
  async inEveryRendering(
    run: (how: { json: boolean; env: NodeJS.ProcessEnv }) => Promise<CliResult>,
  ): Promise<void> {
    const ran: CliResult[] = [];
    for (const how of [
      { json: true, terminal: false, env: {} },
      { json: false, terminal: false, env: {} },
      // Output on a screen with the input a file, as a run in CI with a
      // terminal attached has: a command that would ask something fails fast
      // rather than waiting for an answer no test can give. `NO_COLOR` for the
      // plain one, because on a terminal `picocolors` colours by itself, so
      // leaving `FORCE_COLOR` unset would be the coloured run twice.
      { json: false, terminal: true, env: { FORCE_COLOR: "1" } },
      { json: false, terminal: true, env: { NO_COLOR: "1" } },
      // A script reading the envelope with a terminal attached, which is the
      // one rendering where `logJson` colours before it spells out.
      { json: true, terminal: true, env: { FORCE_COLOR: "1" } },
    ]) {
      const once = (): Promise<CliResult> => {
        return run({ json: how.json, env: how.env });
      };
      const result = await (how.terminal ? onTerminalReadingAFile(once) : offTerminal(once));
      ran.push(result);
      // A run that named no command would otherwise pass every rendering but
      // the one the envelope is checked in.
      expect(result.stdout + result.stderr, "the command ran").not.toContain(
        "is not a zitadel command",
      );
      if (how.env.FORCE_COLOR === undefined) {
        expect(
          result.stdout + result.stderr,
          "a run without colour carries no colour code",
        ).not.toContain("\u001B");
      }
    }
    // The two runs on a terminal came last and back to back, so they ended the
    // same way: what the envelope says, the screen says in the same words.
    const [onScreen, asEnvelope] = ran.slice(-2);
    if (onScreen !== undefined && asEnvelope !== undefined) {
      assertOneText(asEnvelope, onScreen);
    }
  }

  /**
   * `command` as this fixture's runs suggest it again: with the server and
   * `--cwd` every run is given, so a spec states the whole suggestion.
   */
  againAsRun(command: string): string {
    return `${command} --server ${MOCK_SERVER_URL} --cwd ${this.path}`;
  }

  /** For output oclif owns rather than our envelope: `--help`, `--version`. */
  runUnenveloped(args: string[], env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
    return this.cli(args, env, { envelope: false });
  }

  /** Without `--server`, so the spec sees which server the CLI resolves itself. */
  async runWithoutServer(args: string[], env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
    const result = await runCliForTest([...args, "--cwd", this.path], env);
    assertNothingDrivesTheTerminal(result, args);
    if (args.includes("--json")) {
      assertEnvelope(result, args);
    }
    return result;
  }

  /** Sets a project variable, whose value is piped rather than passed as a flag. */
  setVariable(
    name: string,
    value: string,
    { secret = false, preview = false, dryRun = false } = {},
  ): Promise<CliResult> {
    return this.pipingStdin(value, () =>
      this.cli([
        "variable",
        "set",
        name,
        "--json",
        ...(secret ? ["--secret"] : []),
        ...(preview ? ["--preview"] : []),
        ...(dryRun ? ["--dry-run"] : []),
      ]),
    );
  }

  /** `variable set` without `--json`, for a spec asserting what the developer reads. */
  setVariableRendered(name: string, ...args: string[]): Promise<CliResult> {
    return this.cli(["variable", "set", name, ...args]);
  }

  /**
   * Sets a project variable when nothing was piped in: stdin is the keyboard,
   * which is what a script that forgot the pipe has.
   */
  setVariableWithNothingPiped(name: string, { secret = false } = {}): Promise<CliResult> {
    return this.withKeyboardOnStdin(() =>
      this.cli([
        "variable",
        "set",
        name,
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

  getVariable(
    name: string,
    { preview = false, dryRun = false, json = true } = {},
  ): Promise<CliResult> {
    return this.cli([
      "variable",
      "get",
      name,
      ...(json ? ["--json"] : []),
      ...(preview ? ["--preview"] : []),
      ...(dryRun ? ["--dry-run"] : []),
    ]);
  }

  /** Adds one origin pattern to the project. */
  addOrigin(pattern: string, kind: "primary" | "preview"): Promise<CliResult> {
    return this.cli(["origin", "add", pattern, "--kind", kind, "--json"]);
  }

  /** Removes one origin pattern, non-interactively. */
  removeOrigin(pattern: string): Promise<CliResult> {
    return this.cli(["origin", "rm", pattern, "--force", "--json"]);
  }

  /**
   * Removes every origin the project holds, `setup`'s own included, so a spec
   * starts from the empty list, which admits any origin.
   */
  async clearOrigins(): Promise<void> {
    for (const { pattern } of await this.projectOrigins()) {
      expect(await this.removeOrigin(pattern), `removing ${pattern}`).toSucceed();
    }
  }

  /**
   * Leaves the app's origins as `zitadel setup` 0.1.0 registered them: its
   * issuer a preview origin and nothing primary, on the project and in
   * `.zitadel/secret`.
   */
  async hasItsIssuerAsAPreviewOrigin(): Promise<void> {
    expect(await this.removeOrigin(SETUP_ORIGIN.pattern), "removing the issuer").toSucceed();
    expect(await this.addOrigin(SETUP_ORIGIN.pattern, "preview"), "adding it back").toSucceed();
    await this.editDocument(".zitadel/secret", SecretOriginsSchema, (secret) => {
      secret.primary_origins = [];
      secret.preview_origins = [SETUP_ORIGIN.pattern];
    });
  }

  /** The origin patterns the project admits, read back through `origin list`. */
  async projectOrigins(): Promise<ProjectOrigin[]> {
    const result = await this.cli(["origin", "list", "--json"]);
    expect(result, "origin list should have succeeded").toSucceed();
    return this.envelopeOf<{ items: ProjectOrigin[] }>(result).data.items;
  }

  removeVariable(
    name: string,
    { preview = false, dryRun = false }: { preview?: boolean; dryRun?: boolean } = {},
  ): Promise<CliResult> {
    return this.cli([
      "variable",
      "rm",
      name,
      "--force",
      "--json",
      ...(preview ? ["--preview"] : []),
      ...(dryRun ? ["--dry-run"] : []),
    ]);
  }

  /**
   * The variables a deployment froze, read through `variable resolve`: the one
   * live on a target, or the one `deploymentId` names.
   */
  resolveVariables({
    origin,
    deploymentId,
    json = true,
  }: {
    origin?: string;
    deploymentId?: string;
    json?: boolean;
  } = {}): Promise<CliResult> {
    return this.cli([
      "variable",
      "resolve",
      ...(deploymentId === undefined ? [] : [deploymentId]),
      ...(json ? ["--json"] : []),
      ...(origin === undefined ? [] : ["--origin", origin]),
    ]);
  }

  /** The providers the platform has registered. */
  registeredIdps(): Promise<RegisteredIdp[]> {
    return this.listed<RegisteredIdp>("idps");
  }

  /** The policies the platform holds, each at its newest revision. */
  publishedPolicies(): Promise<PublishedPolicy[]> {
    return this.listed<PublishedPolicy>("policies");
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
  async projectVariables({ preview = false } = {}): Promise<ProjectVariable[]> {
    const result = await this.cli([
      "variable",
      "list",
      "--json",
      ...(preview ? ["--preview"] : []),
    ]);
    expect(result, "variable list should have succeeded").toSucceed();
    return this.envelopeOf<{ items: ProjectVariable[] }>(result).data.items;
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

  /**
   * The auth methods the published user schema names, as `schemas list`
   * reports them.
   *
   * @returns The schema's `x-auth-methods`, empty when it names none.
   */
  async publishedAuthMethods(): Promise<NonNullable<UserSchemaDocument["x-auth-methods"]>> {
    const { schema } = await this.publishedSchema();
    return schema["x-auth-methods"] ?? {};
  }

  /**
   * Deploys the project's files, failing the arrange if the deploy does not
   * succeed, then reads the auth methods the published user schema names.
   *
   * @returns The published schema's `x-auth-methods`.
   */
  async authMethodsOnceDeployed(): Promise<NonNullable<UserSchemaDocument["x-auth-methods"]>> {
    await this.publishData();
    return this.publishedAuthMethods();
  }

  /**
   * Deploys the project's files, failing the arrange if the deploy does not
   * succeed, then reads the published steps that offer a provider.
   *
   * @returns The steps, as {@link stepsOfferingSso} reads them.
   */
  async stepsOfferingSsoOnceDeployed(): Promise<FlowStep[]> {
    await this.publishData();
    return this.stepsOfferingSso();
  }

  /**
   * Deploys the project's files, then reads each distinct list of providers a
   * published step offers: one list when every step offers the same ones.
   *
   * @returns The distinct `sso_providers` lists, in step order.
   */
  async providerListsOfferedOnceDeployed(): Promise<string[][]> {
    const lists = new Map<string, string[]>();
    for (const step of await this.stepsOfferingSsoOnceDeployed()) {
      const providers = step.sso_providers ?? [];
      lists.set(JSON.stringify(providers), providers);
    }
    return [...lists.values()];
  }

  /**
   * Deploys the project's files, then names the published steps that offer a
   * provider but give `outcome` no transition.
   *
   * @param outcome - The transition every offering step should name.
   * @returns The names of the steps that lack it.
   */
  async stepsOfferingSsoWithoutOnceDeployed(outcome: string): Promise<string[]> {
    const steps = await this.stepsOfferingSsoOnceDeployed();
    return steps
      .filter((step) => {
        return !Object.hasOwn(step.transitions ?? {}, outcome);
      })
      .map((step) => {
        return step.name;
      });
  }

  /**
   * Deploys the project's files, then reads the slugs of the providers the
   * platform has registered, sorted.
   *
   * @returns The registered slugs.
   */
  async registeredIdpSlugsOnceDeployed(): Promise<string[]> {
    await this.publishData();
    const registered = await this.registeredIdps();
    return registered
      .map((idp) => {
        return idp.slug;
      })
      .sort();
  }

  /**
   * Deploys the project's files, failing the arrange if the deploy does not
   * succeed, then runs `deploy --dry-run`, which refuses when the platform
   * and the files still differ.
   *
   * @returns The dry run.
   */
  async deployDryRunOnceDeployed(): Promise<CliResult> {
    await this.publishData();
    return this.deployDryRun();
  }

  /**
   * Deploys the project's files twice in a row, failing the arrange if either
   * deploy does not succeed.
   *
   * @returns The release each deploy made live, first then again.
   */
  async releasesOfTwoDeploys(): Promise<Array<string | undefined>> {
    const first = await this.publishData();
    const again = await this.deployData();
    return [first.release_id, again.release_id];
  }

  /**
   * Runs `auth-method password|passkey disable`, failing the arrange if it
   * does not succeed.
   *
   * @param method - The method to turn off.
   */
  async hasDisabledMethod(method: "password" | "passkey"): Promise<void> {
    const result = await this.disableMethod(method);
    expect(result, `arranging auth-method ${method} disable should have succeeded`).toSucceed();
  }

  /**
   * Turns `method` off in the committed user schema, as the developer owning it
   * would, without a command.
   *
   * @param method - The method to turn off.
   */
  hasTurnedOffByHand(method: "password" | "passkey"): Promise<void> {
    return this.editUserSchema((schema) => {
      schema["x-auth-methods"] = { ...schema["x-auth-methods"], [method]: { enabled: false } };
    });
  }

  /**
   * Removes the committed user schema's `x-identifier`, so nothing names what
   * a password is checked against.
   */
  lacksAnIdentifier(): Promise<void> {
    return this.editDocument(SCHEMA_FILE, AnyObjectSchema, (schema) => {
      delete schema["x-identifier"];
    });
  }

  /**
   * Runs `auth-method sso enable` with exactly these flags and this secret
   * piped, failing the arrange if it does not succeed.
   *
   * @param args - The flags naming the provider and its client id.
   * @param secret - The client secret, piped as a script would.
   */
  async hasEnabledSsoWith(args: string[], secret: string): Promise<void> {
    const result = await this.enableSsoWith(args, secret);
    expect(result, "arranging auth-method sso enable should have succeeded").toSucceed();
  }

  /**
   * Enables a catalog provider, failing the arrange if it does not succeed.
   *
   * @param provider - The catalog provider.
   * @param credentials - Its client id and secret.
   */
  async hasEnabledSso(provider: string, credentials: Credentials): Promise<void> {
    const result = await this.enableSso(provider, credentials);
    expect(result, "arranging auth-method sso enable should have succeeded").toSucceed();
  }

  /**
   * Enables a connection the developer describes, failing the arrange if it
   * does not succeed.
   *
   * @param connection - The connection.
   * @param credentials - Its client id and secret.
   */
  async hasEnabledCustomSso(connection: CustomConnection, credentials: Credentials): Promise<void> {
    const result = await this.enableCustomSso(connection, credentials);
    expect(result, "arranging auth-method sso enable should have succeeded").toSucceed();
  }

  /**
   * Runs `auth-method sso disable`, failing the arrange if it does not succeed.
   *
   * @param provider - The provider to remove.
   */
  async hasDisabledSso(provider: string): Promise<void> {
    const result = await this.disableSso(provider);
    expect(result, "arranging auth-method sso disable should have succeeded").toSucceed();
  }

  /** What the fake npm was asked to do, for the install leg of setup. */
  async installInvocation(): Promise<{ cwd: string; args: string[] }> {
    if (this.installLogPath === undefined) {
      throw new Error("setup was not run with { install: true }");
    }
    return InstallLog.parse(JSON.parse((await readFile(this.installLogPath, "utf8")).trim()));
  }

  /**
   * The app's directory with every symlink resolved, as a process the CLI
   * starts in it sees its working directory.
   *
   * @returns The resolved directory.
   */
  realPath(): Promise<string> {
    return realpath(this.path);
  }

  /**
   * `command` as setup suggests it: aimed at the project setup created by the
   * env file it wrote, and run from `--cwd`.
   *
   * @param command - The command, after the runner.
   * @returns The whole suggestion.
   */
  asSetupSuggests(command: string): string {
    return `${command} --env-file ${this.path}/.env.development.local --cwd ${this.path}`;
  }

  /**
   * The envelope a `--json` run printed, its `data` read as `T`.
   *
   * The cast stays: the spec names the shape of `data`, which differs for
   * every command and is spelled at each of its many callers across the specs,
   * so this signature is theirs. The envelope's own fields are not taken on
   * trust: {@link assertEnvelope} checks them on every `--json` run.
   *
   * @param result - The finished run.
   * @returns Its envelope.
   */
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
    return this.editDocument(SCHEMA_FILE, UserSchemaDocumentSchema, edit);
  }

  /**
   * Leaves `method` the schema's only way to sign in, with no login flow that
   * would refuse removing it, so disabling it removes the last way in.
   */
  async signsInOnlyWith(method: "password" | "passkey"): Promise<void> {
    await this.editUserSchema((schema) => {
      schema["x-auth-methods"] = {
        password: { enabled: method === "password" },
        passkey: { enabled: method === "passkey" },
      };
    });
    await this.deleteProjectFile(FLOW_FILE);
  }

  /** {@link signsInOnlyWith} for an SSO provider the project already offers. */
  async signsInOnlyWithSso(provider: string): Promise<void> {
    await this.editUserSchema((schema) => {
      schema["x-auth-methods"] = {
        password: { enabled: false },
        passkey: { enabled: false },
        sso: { enabled: true, providers: [provider] },
      };
    });
    await this.deleteProjectFile(FLOW_FILE);
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
    return this.editDocument(`.zitadel/idps/${slug}.json`, ConnectionDocumentSchema, edit);
  }

  /** Adds a second connection file that claims the same slug as an existing one. */
  async copyConnection(slug: string, name: string): Promise<void> {
    await this.writeProjectFile(
      `.zitadel/idps/${name}.json`,
      await this.readProjectFile(`.zitadel/idps/${slug}.json`),
    );
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

  /**
   * Removes one editor schema setup wrote, as a project set up by a CLI that
   * did not ship that dialect yet would lack it.
   */
  lacksEditorSchema(dialect: string): Promise<void> {
    return this.deleteProjectFile(`.zitadel/meta/${dialect}.json`);
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

  /**
   * Writes the password policy file, as the developer owning it would: named
   * after its operation unless `name` says otherwise.
   */
  async writePasswordPolicy(
    config: Record<string, number>,
    { name = PASSWORD_POLICY, extra = {} }: { name?: string; extra?: Record<string, unknown> } = {},
  ): Promise<void> {
    await mkdir(join(this.path, ".zitadel/policies"), { recursive: true });
    await this.writeProjectFile(
      this.policyFile(name),
      `${JSON.stringify({ $schema: "../meta/policy.json", operation: PASSWORD_POLICY, config, ...extra }, null, 2)}\n`,
    );
  }

  /** Writes the sign-up policy file, as the developer owning it would. */
  async writeSignupPolicy(config: Record<string, string>): Promise<void> {
    await mkdir(join(this.path, ".zitadel/policies"), { recursive: true });
    await this.writeProjectFile(
      this.policyFile(DEFAULT_SIGNUP_POLICY.operation),
      `${JSON.stringify({ $schema: "../meta/policy.json", operation: DEFAULT_SIGNUP_POLICY.operation, config }, null, 2)}\n`,
    );
  }

  /** Writes the password policy's test file with `cases`, as the developer owning it would. */
  async writePolicyTest(cases: ReadonlyArray<Record<string, unknown>>): Promise<void> {
    await mkdir(join(this.path, ".zitadel/policies"), { recursive: true });
    await this.writeProjectFile(
      `.zitadel/policies/${PASSWORD_POLICY}.test.json`,
      `${JSON.stringify({ $schema: "../meta/policy-test.json", operation: PASSWORD_POLICY, cases }, null, 2)}\n`,
    );
  }

  /** Runs `zitadel policies test` with `args`. */
  testPolicies(args: string[] = []): Promise<CliResult> {
    return this.run(["policies", "test", "--non-interactive", ...args]);
  }

  /** Removes the committed password policy file, as the developer owning it would. */
  removePasswordPolicy(): Promise<void> {
    return this.deleteProjectFile(this.policyFile(PASSWORD_POLICY));
  }

  /** The project-relative path of a policy file, as a command reports it. */
  policyFile(name: string = PASSWORD_POLICY): string {
    return `.zitadel/policies/${name}.json`;
  }

  /** Edits the committed login flow, as the developer owning it would. */
  editLoginFlow(edit: (flow: FlowDocument) => void): Promise<void> {
    return this.editDocument(FLOW_FILE, FlowDocumentSchema, edit);
  }

  /** Edits the step a visitor lands on to log in, as the developer owning the flow would. */
  editLoginEntryStep(edit: (step: FlowDocument["steps"][number]) => void): Promise<void> {
    return this.editLoginFlow((flow) => {
      const step = flow.steps.find((candidate) => candidate.name === flow.purposes.login);
      if (step === undefined) {
        throw new Error("the login flow has no login entry step");
      }
      edit(step);
    });
  }

  editPackageJson(edit: (pkg: PackageJson) => void): Promise<void> {
    return this.editDocument("package.json", PackageJsonSchema, edit);
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

  /**
   * The values setup bound the development environment to — its file, then the
   * project secret for anything the file leaves out — for binding another
   * environment to the same project.
   */
  async developmentValues(): Promise<Record<string, string>> {
    const file = parseEnv(await readFile(join(this.path, ".env.development.local"), "utf8"));
    const secret = ProjectSecret.parse(
      JSON.parse(await readFile(join(this.path, ".zitadel/secret"), "utf8")),
    );
    return {
      ZITADEL_PROJECT_ID: secret.project_id,
      ZITADEL_PROJECT_SECRET: secret.project_secret,
      ZITADEL_PREVIEW_TOKEN: secret.preview_secret,
      ...Object.fromEntries(
        Object.entries(file).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
    };
  }

  /**
   * How a question to a person names where it would act: the project this app
   * is bound to, then the server's host without its scheme.
   *
   * @param serverUrl - The server the run is pointed at, which defaults to the mock platform.
   * @returns `project <id> on <host>`.
   */
  async projectPlace(serverUrl = MOCK_SERVER_URL): Promise<string> {
    const { ZITADEL_PROJECT_ID } = await this.developmentValues();
    return `project ${ZITADEL_PROJECT_ID} on ${new URL(serverUrl).host}`;
  }

  /** Writes `.env.<name>.local`, the file that binds an environment to a project. */
  bindEnvironment(name: string, values: Record<string, string>): Promise<void> {
    return this.writeProjectFile(`.env.${name}.local`, dotenv(values));
  }

  /** Writes a dotenv file the developer keeps anywhere, returning the path `--env-file` takes. */
  async writeEnvFile(fileName: string, values: Record<string, string>): Promise<string> {
    await this.writeProjectFile(fileName, dotenv(values));
    return join(this.path, fileName);
  }

  /**
   * Edits a committed JSON document in place, as the developer owning it
   * would, once it passes `schema`'s checks.
   *
   * @param relativePath - The file, from the project's root.
   * @param schema - The shape the edit expects the document to have.
   * @param edit - Changes the document as read.
   */
  private async editDocument<T>(
    relativePath: string,
    schema: z.ZodType<T>,
    edit: (document: T) => void,
  ): Promise<void> {
    const contents = await readFile(join(this.path, relativePath), "utf8");
    const document: unknown = JSON.parse(contents);
    if (!conforms(schema, document)) {
      throw new Error(`${relativePath} is not the document this edit expects: ${contents}`);
    }
    edit(document);
    await writeFile(join(this.path, relativePath), `${JSON.stringify(document, null, 2)}\n`);
  }

  private installLogPath: string | undefined;
  private refreshLogPath: string | undefined;

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
    assertNothingDrivesTheTerminal(result, args);
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
   *
   * Public for a spec that drives a command taking its value that way rather
   * than in argv, where the fixture has no helper of its own for it.
   */
  async pipingStdin<T>(text: string, run: () => Promise<T>): Promise<T> {
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

function dotenv(values: Record<string, string>): string {
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

/**
 * The one item a list holds.
 *
 * @param items - The list.
 * @param what - What the items are, for the failure.
 * @returns The item, when there is exactly one.
 */
function only<T>(items: T[], what: string): T {
  const [item] = items;
  if (items.length !== 1 || item === undefined) {
    throw new Error(`expected exactly one ${what} on the platform, found ${items.length}`);
  }
  return item;
}

/** ESC, spelled out, so this file holds no control character of its own. */
const ESC = "\\u001b";

/**
 * The zero-width joiner and non-joiner, which spell a word — an emoji, an
 * Arabic or Indic name — rather than drive anything, and so are not a leak.
 */
const SPELLING = "\\u200c\\u200d";

/**
 * The colour the CLI itself applies: a CSI sequence ending in `m`, and nothing
 * else. Everything else an ESC can start — clearing the screen, setting the
 * window title, writing the reader's clipboard through OSC 52 — is what
 * {@link assertNothingDrivesTheTerminal} is looking for.
 */
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

/**
 * Every character a terminal acts on rather than prints, less the colour above
 * and less the newline, tab and carriage return that lay output out: the C0
 * controls, DEL, the C1 controls, the format and bidi controls, and the line
 * and paragraph separators.
 *
 * Spelled out here rather than imported from the escaper this audits, so the
 * two agreeing is a result and not an arrangement.
 */
const DRIVES_A_TERMINAL = new RegExp(
  `[[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]--[${SPELLING}\\n\\t\\r]]`,
  "gv",
);

/**
 * Nothing a run printed may drive the reader's terminal.
 *
 * Checked on every invocation a spec makes — the ones this fixture runs in
 * process and the one it spawns — not only the `--json` ones and not in a suite
 * of its own, because a command that interpolates what the server answered into
 * its own words is the shape this guards and every command has that shape. A
 * command that leaves one through fails in its own spec.
 *
 * The CLI's own colour is allowed, and a `\u001b` written out as the six
 * characters of its JSON escape is text, not a control character, so a payload
 * that carries one passes.
 */
export function assertNothingDrivesTheTerminal(
  // The two streams and nothing else, so a run the fixture spawns rather than
  // runs in process is held to this as well.
  result: { stdout: string; stderr: string },
  args: string[] = [],
): void {
  const where = `\`${args.filter((arg) => !arg.startsWith("-")).join(" ")}\``;
  for (const [stream, text] of [
    ["stdout", result.stdout],
    ["stderr", result.stderr],
  ] as const) {
    const left = text.replace(SGR, "");
    const found = left.match(DRIVES_A_TERMINAL);
    if (found !== null) {
      const spelled = [...new Set(found)]
        .map(
          (char) => `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`,
        )
        .join(", ");
      expect.fail(
        `${where}: ${stream} carries ${spelled}, which drives the reader's terminal.\n` +
          `${stream}: ${JSON.stringify(text)}`,
      );
    }
  }
  assertEndingIsWellFormed(result, where);
  assertAJsonBodyParses(result, where);
}

/**
 * A run's ending is built from the command's own words, which at a colour
 * terminal carry escapes, so a rule that reads them only when they are bare
 * leaves a coloured run ending differently from a plain one. Two symptoms say
 * so for any command, in any rendering: the command overview named twice, and
 * a step's `$ command` line left raw inside the box instead of being laid out
 * as a step. Both are checked here, on every invocation, because the command
 * that breaks them is never the one a spec for colour was written for.
 */
export function assertEndingIsWellFormed(
  result: { stdout: string; stderr: string },
  where: string,
): void {
  for (const [stream, raw] of [
    ["stdout", result.stdout],
    ["stderr", result.stderr],
  ] as const) {
    const text = raw.replace(SGR, "");
    const overview = text.match(/Explore all commands:/g)?.length ?? 0;
    expect(
      overview,
      `${where}: ${stream} names the command overview ${overview} times`,
    ).toBeLessThan(2);
    const raw$ = text.split("\n").filter((line) => /^\s*│\s+\$ /.test(line));
    expect(raw$, `${where}: ${stream} has a raw $ command line inside its box`).toEqual([]);
    // A command a person is told to run is one line: broken across lines with
    // nothing to continue it, it can no longer be copied and run. A line that
    // continues a `$` command, indented under it and not ended by a backslash,
    // is that command folded as prose.
    const lines = text.split("\n");
    const folded = lines.filter(
      (line, at) =>
        /^ {4}-{1,2}\w/.test(line) &&
        /^ {2}\$ /.test(lines[at - 1] ?? "") &&
        !/\\$/.test(lines[at - 1] ?? ""),
    );
    expect(folded, `${where}: ${stream} folds a command across lines`).toEqual([]);
    // The CLI's own colour spelled out a second time is a pair: the code that
    // starts it and the reset that ends it (`\x1b[36m` ... `\x1b[39m`). A
    // hostile payload that carries a colour sequence spells out the one it was
    // given, which is not followed by a reset the CLI added, so a lone code is
    // allowed and only the pair is refused.
    const spelled = text.match(/\\x1b\[[0-9;]*m/g) ?? [];
    const closes = spelled.some((code) => /^\\x1b\[(?:0|22|39|49)m$/.test(code));
    const opens = spelled.some((code) => !/^\\x1b\[(?:0|22|39|49)m$/.test(code));
    expect(
      opens && closes ? spelled : [],
      `${where}: ${stream} prints a colour code as text`,
    ).toEqual([]);
  }
}

/**
 * A body a script would parse must parse.
 *
 * Spelling a character out keeps it off the reader's terminal but says nothing
 * about which spelling was used, and the terminal one — `\x9b` — is not an
 * escape JSON has. So a run whose stdout is a JSON object is parsed here, on
 * every invocation a spec makes, which is the only thing that tells a document
 * spelled for a person apart from one spelled for a parser.
 *
 * An object and nothing else: a `{` cannot begin anything else the CLI prints,
 * whereas a `[` begins a line's own prefix as readily as an array, and
 * a rule that has to tell those apart would be guessing rather than checking. A
 * command whose body is a bare array says so in its own spec.
 */
function assertAJsonBodyParses(result: { stdout: string }, where: string): void {
  const body = result.stdout.trim();
  if (!body.startsWith("{")) {
    return;
  }
  try {
    JSON.parse(body);
  } catch (error) {
    expect.fail(
      `${where}: stdout is a JSON document that does not parse (${String(error)}).\n` +
        `stdout: ${JSON.stringify(result.stdout)}`,
    );
  }
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
  // A JSON envelope must never carry a raw ANSI colour byte: one would break
  // `JSON.parse` and `jq` for every consumer. Checked on every spec's `--json`
  // run rather than in a suite of its own, so a command that hand-writes colour
  // onto the structured stream fails in that command's own spec. (A U+001B
  // inside a string value is safe — `JSON.stringify` escapes it to `\u001b`, so
  // this only trips on a raw control byte on stdout.)
  expect(result.stdout, `${where}: JSON output contains ANSI colour codes`).not.toContain("\u001B");
  const parsed = parseJsonOrUndefined(result.stdout);
  if (parsed === undefined) {
    throw new Error(
      `${where} emitted no JSON envelope on stdout.\n` +
        `stdout: ${result.stdout || "(empty)"}\nstderr: ${result.stderr || "(empty)"}`,
    );
  }
  const fields = EnvelopeFields.safeParse(parsed);
  const envelope: z.infer<typeof EnvelopeFields> = fields.success ? fields.data : {};
  expect(envelope.cli_version, `${where}: cli_version missing`).toBeTypeOf("string");
  expect(envelope.command, `${where}: command missing`).toBeTypeOf("string");
  expect(envelope.source, `${where}: source missing`).toBeTypeOf("string");
  expect(envelope.status, `${where}: status missing or unknown`).toMatch(/^(ok|skipped|error)$/);
  if (envelope.status === "error") {
    expect(envelope.code, `${where}: error envelope carries no code`).toBeTypeOf("string");
  }
  const contract = ContractEnvelope.parse(parsed);
  assertRunnableSuggestions(where, contract);
  assertDataShape(where, contract);
  if (args.includes("--dry-run")) {
    assertDryRun(where, parsed);
  }
}

/**
 * Whether a text holds a control character, which a screen spells out.
 *
 * @param text - The text.
 * @returns Whether it holds one.
 */
function hasControlCharacter(text: string): boolean {
  return [...text].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });
}

/**
 * A message is written once: the envelope's error `message`, or its
 * `data.title`, is on the screen word for word, never capitalised, trimmed or
 * ended with a full stop for one of the two, and each warning is said exactly
 * once. Skipped for a text holding a control character, which the screen spells
 * out. The two runs must have ended the same way and the envelope must parse:
 * a check that skips on either would pass on what it was meant to catch.
 *
 * @param envelope - The run that printed the envelope.
 * @param screen - The same run, as a person reads it.
 */
export function assertOneText(envelope: CliResult, screen: CliResult): void {
  expect(envelope.exitCode, "the envelope run and the screen run ended the same way").toBe(
    screen.exitCode,
  );
  const body = parseJsonOrUndefined(stripAnsi(envelope.stdout));
  const parsed = z
    .object({
      status: z.string(),
      message: z.string().optional(),
      warnings: z.array(z.string()).optional(),
      data: z.object({ title: z.string().optional() }).passthrough().optional(),
    })
    .safeParse(body);
  expect(parsed.success, "the envelope run printed an envelope that parses").toBe(true);
  if (!parsed.success) {
    return;
  }
  const said = parsed.data.status === "error" ? parsed.data.message : parsed.data.data?.title;
  const printed = stripAnsi(`${screen.stdout}\n${screen.stderr}`);
  if (said !== undefined && !hasControlCharacter(said)) {
    expect(printed, "the screen says what the envelope says").toContain(said);
  }
  for (const warning of parsed.data.warnings ?? []) {
    if (!hasControlCharacter(warning)) {
      expect(
        printed.split(warning).length - 1,
        `the warning "${warning}" is said exactly once on the screen`,
      ).toBe(1);
    }
  }
}

/**
 * A dry run answers `ok` with `data.dry_run: true` and a headline ending in
 * `(dry run)`; it is never `skipped`, which means a person said no. Checked on
 * every spec's `--dry-run --json` run, so a command that breaks the rule fails
 * in its own spec. A refusal is an error, and a skip for another reason keeps
 * its own token. The headline is `data.title`, the words the terminal draws.
 *
 * @param where - The command, for the failure message.
 * @param parsed - The parsed envelope.
 */
export function assertDryRun(where: string, parsed: unknown): void {
  const shape = z
    .looseObject({
      status: z.string(),
      reason: z.string().optional(),
      data: z
        .looseObject({ dry_run: z.unknown().optional(), title: z.unknown().optional() })
        .optional(),
    })
    .safeParse(parsed);
  expect(shape.success, `${where}: a dry run answers an envelope that parses`).toBe(true);
  if (!shape.success) {
    return;
  }
  const { status, reason, data } = shape.data;
  expect(reason, `${where}: a dry run is answered ok, never skipped as a dry run`).not.toBe(
    "dry-run",
  );
  if (status !== "ok") {
    return;
  }
  expect(data?.dry_run, `${where}: a dry run says data.dry_run`).toBe(true);
  expect(typeof data?.title, `${where}: a dry run carries its headline as data.title`).toBe(
    "string",
  );
  expect(data?.title, `${where}: a dry run's headline ends in (dry run)`).toMatch(/\(dry run\)$/);
}

/**
 * The fields of an envelope the contract asserts, each read as it is so the
 * assertion, not the parse, reports one that is missing or of the wrong kind.
 */
const EnvelopeFields = z.looseObject({
  cli_version: z.unknown().optional(),
  command: z.unknown().optional(),
  source: z.unknown().optional(),
  status: z.unknown().optional(),
  code: z.unknown().optional(),
});

/**
 * An envelope that has passed the asserted half of the contract, read for the
 * checks that follow: its suggestions and the shape of its `data`.
 */
const ContractEnvelope = z.looseObject({
  status: z.enum(["ok", "skipped", "error"]),
  command: z.string(),
  message: z.string().optional(),
  hint: z.string().optional(),
  next_commands: z.array(z.string()).optional(),
  data: z.unknown().optional(),
});

/** An envelope as {@link assertDataShape} reads it. */
type ContractEnvelope = z.infer<typeof ContractEnvelope>;

/**
 * The `data`-shape half of the contract, enforced on every command so an agent
 * reads every command's output the same way.
 *
 * Classed off the resolved command id (`envelope.command`), not the raw argv, so
 * a positional argument that happens to be the word `list` (e.g. `variable get
 * list`) is never misread as a list command. A `list` command (and `resources`,
 * the one collection not named `… list`) must use the canonical
 * `{ items, count, next_page_token }` envelope (`listData`); any command that
 * emits `items` must carry `count` and `next_page_token`; a delete command must
 * confirm with `deleted: true` (`deletedData`), and no command anywhere may use
 * `removed`. A dry run has its own preview shape, so it is exempt. A divergent
 * shape fails in that command's own spec, not a central list someone forgot to
 * update.
 */
function assertDataShape(where: string, envelope: ContractEnvelope): void {
  if (envelope.status !== "ok") {
    return;
  }
  const { data } = envelope;
  if (typeof data !== "object" || data === null) {
    return;
  }
  // A dry run previews what a write would do; it carries `dry_run: true` and
  // not the real result shape, so the shape contract does not apply to it.
  if ("dry_run" in data && data.dry_run === true) {
    return;
  }
  const { command } = envelope;
  const verb = command.split(/[:\s]/).filter(Boolean).pop() ?? "";
  const items = "items" in data ? data.items : undefined;

  if (verb === "list" || command === "resources") {
    expect(
      Array.isArray(items),
      `${where}: a list command must emit its rows under \`items\` (use listData())`,
    ).toBe(true);
  }
  if (Array.isArray(items)) {
    const count = "count" in data ? data.count : undefined;
    expect(typeof count, `${where}: a list envelope needs a numeric \`count\``).toBe("number");
    const token = "next_page_token" in data ? data.next_page_token : undefined;
    expect(
      token === null || typeof token === "string",
      `${where}: a list envelope needs \`next_page_token\` (string or null), got ${JSON.stringify(token)}`,
    ).toBe(true);
  }
  if (verb === "rm" || verb === "delete" || verb === "remove") {
    expect(
      "deleted" in data && data.deleted === true,
      `${where}: a \`${verb}\` command must confirm with \`deleted: true\` (use deletedData())`,
    ).toBe(true);
  }
  expect(
    Object.hasOwn(data, "removed"),
    `${where}: confirm a delete with \`deleted: true\`, never \`removed\` (use deletedData())`,
  ).toBe(false);
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
  usesClaudeCode = false,
}: {
  nextVersion?: string;
  usesClaudeCode?: boolean;
} = {}): Promise<ScaffoldedApp> {
  const path = await mkdtemp(join(tmpdir(), "zitadel-next-"));
  if (usesClaudeCode) {
    await mkdir(join(path, ".claude"), { recursive: true });
  }

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
 * accepts for a package unless a `name` says otherwise.
 */
export async function aNewAppDirectory(name = "my-app"): Promise<ScaffoldedApp> {
  const parent = await mkdtemp(join(tmpdir(), "zitadel-new-"));
  const path = join(parent, name);
  await mkdir(path);
  return new ScaffoldedApp(path);
}

/**
 * A directory for setup to create a new app in that does not exist yet, under
 * one that does: how `--cwd` names the folder a new app should live in.
 */
export async function aMissingAppDirectory(): Promise<ScaffoldedApp> {
  const parent = await mkdtemp(join(tmpdir(), "zitadel-new-"));
  return new ScaffoldedApp(join(parent, "my-app"));
}

/**
 * An app already through `setup`, for specs about the commands after it.
 *
 * Setup's git commit is turned off here: this is the arrange for every other
 * command's spec, and a repository of setup's making is not what they are
 * about. Setup's spec drives setup with it on, and owns what it does.
 */
export async function aSetUpApp(extraArgs: string[] = []): Promise<ScaffoldedApp> {
  const app = await anApp();
  const result = await app.setup(["--no-git", ...extraArgs]);
  expect(result, "arranging setup should have succeeded").toSucceed();
  return app;
}

/**
 * A set-up app with a second environment, `staging`, that `env add` bound and
 * nothing has been deployed to: setup deploys its own project, so this is
 * where a spec finds a first deploy. Address it with `--env staging`.
 */
export async function anUndeployedEnvironment(): Promise<ScaffoldedApp> {
  const app = await aSetUpApp();
  const added = await app.run([
    "env",
    "add",
    "staging",
    "--app-url",
    "https://staging.acme.com",
    "--non-interactive",
    "--json",
  ]);
  expect(added, "arranging env add should have succeeded").toSucceed();
  return app;
}

/**
 * A second working copy of the same project: a fresh app directory carrying
 * the project's `.zitadel/secret` but none of its resource files, the way a
 * developer who cloned the repo reaches a project someone else deployed.
 *
 * @param project - The project to check out again.
 * @returns The checkout.
 */
export async function aFreshCheckoutOf(project: ScaffoldedApp): Promise<ScaffoldedApp> {
  const checkout = await anApp();
  await mkdir(join(checkout.path, ".zitadel"), { recursive: true });
  await checkout.writeProjectFile(
    ".zitadel/secret",
    await project.readProjectFile(".zitadel/secret"),
  );
  return checkout;
}

/**
 * A {@link aFreshCheckoutOf} that already holds a local human-user schema its
 * contract refuses: only the object type the project's own schema has, so a
 * pull has to replace it rather than write a second schema beside it.
 *
 * @param project - The project to check out again.
 * @returns The checkout, holding the refused schema.
 */
export async function aFreshCheckoutHoldingARefusedSchemaOf(
  project: ScaffoldedApp,
): Promise<ScaffoldedApp> {
  const checkout = await aFreshCheckoutOf(project);
  const schema = JSON.parse(await project.readProjectFile(SCHEMA_FILE));
  await mkdir(join(checkout.path, ".zitadel/schemas"), { recursive: true });
  await checkout.writeProjectFile(SCHEMA_FILE, JSON.stringify({ objectType: schema.objectType }));
  return checkout;
}

/**
 * An app through `setup` with its commit kept, so a release built from it
 * records a git sha and a later deploy has a baseline to diff against.
 */
export async function aCommittedApp(): Promise<ScaffoldedApp> {
  const app = await anApp();
  const result = await app.setup();
  expect(result, "arranging setup should have succeeded").toSucceed();
  return app;
}

/** A fake `npm` on PATH that records its invocation instead of installing. */
async function fakePackageManager(
  exitCode = 0,
  slow = false,
): Promise<{ binDir: string; logPath: string }> {
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
${slow ? "setTimeout(() => { process.exitCode = 1; }, 700);" : `process.exitCode = ${String(exitCode)};`}
`,
  );
  await chmod(binPath, 0o755);
  return { binDir, logPath };
}

/** How the fake npm and npx an `upgrade` run is given behave. */
type UpgradeBehavior = {
  refresh?: "done" | "issues" | "broken" | "slow";
  install?: "fails" | "slow";
};

/** A fake `npx` on PATH that records its invocation and answers as the new release's doctor. */
async function fakeNpx(
  outcome: "done" | "issues" | "broken" | "slow",
): Promise<{ binDir: string; logPath: string }> {
  const binDir = await mkdtemp(join(tmpdir(), "zitadel-fake-npx-"));
  const logPath = join(binDir, "npx.log");
  const answer = {
    done: '{"status":"ok"}',
    issues: '{"status":"error"}',
    broken: "not json",
    slow: '{"status":"ok"}',
  }[outcome];
  const binPath = join(binDir, "npx");
  await writeFile(
    binPath,
    `#!/usr/bin/env node
require("node:fs").appendFileSync(
  process.env.FAKE_NPX_LOG,
  JSON.stringify({ args: process.argv.slice(2) }) + "\\n",
);
${outcome === "slow" ? "setTimeout(() => {" : ""}process.stdout.write(${JSON.stringify(answer)});${outcome === "slow" ? "}, 700);" : ""}
`,
  );
  await chmod(binPath, 0o755);
  return { binDir, logPath };
}

/** A `git` on PATH that runs the real one for everything but `commit`, which it refuses. Returns its directory. */
async function gitThatCannotCommit(): Promise<string> {
  const binDir = await mkdtemp(join(tmpdir(), "zitadel-git-no-commit-"));
  const { stdout } = await execFileAsync("sh", ["-c", "command -v git"]);
  await writeFile(
    join(binDir, "git"),
    `#!/bin/sh\nfor arg in "$@"; do\n  if [ "$arg" = "commit" ]; then\n    echo "fatal: cannot commit" >&2\n    exit 1\n  fi\ndone\nexec "${stdout.trim()}" "$@"\n`,
  );
  await chmod(join(binDir, "git"), 0o755);
  return binDir;
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

/** The one terminal harness, re-exported for the specs that reached for it here. */
export { asTerminal };
