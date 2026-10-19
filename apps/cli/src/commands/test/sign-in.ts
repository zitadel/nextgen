import { Flags } from "@oclif/core";
import { idpProvider, IDP_PROVIDERS, referencedVariable } from "@zitadel/config/idp";
import { consola } from "consola";
import pc from "picocolors";

import {
  createZitadelClient,
  escapeControlCharacters,
  type ZitadelClient,
} from "../../lib/api-client";
import { openInBrowser } from "../../lib/browser";
import {
  type CheckResult,
  IDP_CHECKS,
  idpContext,
  PROVIDER_PROBES,
  runChecks,
  type Send,
} from "../../lib/checks/idp";
import { ZitadelError } from "../../lib/errors";
import { type ConnectionFile, callbackUriFor, readConnectionFiles } from "../../lib/idp";
import { isObject } from "../../lib/json";
import { DEFAULT_LOCAL_SERVER_URL, readRuntimeMetadata } from "../../lib/local-server/runtime";
import { LocalServer } from "../../lib/local-server/server";
import { BaseCommand, CommandGroups, type JsonEnvelope, nonBlankString } from "../../lib/oclif";
import { readDevelopmentIssuer, readZitadelConfig, readZitadelSecret } from "../../lib/project";
import { resolveCwd } from "../../lib/paths";
import { publicCliCommand } from "../../lib/public-cli";
import { watchSignInEvents } from "../../lib/sign-in-events";
import { buildSyncPlan, enumeratePlanResources, makeSyncers } from "../../lib/sync";

const GLYPHS = {
  pass: pc.green("✔"),
  warn: pc.yellow("!"),
  fail: pc.red("✖"),
  skipped: pc.dim("–"),
};
const TITLE_WIDTH = 26;
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_TIMEOUT_SECONDS = 300;
const LOG_POLL_MS = 1_000;
/** How much of the log's end one poll reads; a sign-in writes a few lines. */
const LOG_TAIL = 2_000;
/** The resource kinds a sign-in depends on: the connection, the user schema and the login flow. */
const SIGN_IN_KINDS = ["idp", "schema", "flow"];

/** Resolves after `ms`, or as soon as `signal` aborts. */
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/** One HTTP exchange, following redirects, bounded in time and in the body it keeps. */
const send: Send = async (url, init) => {
  const response = await fetch(url, {
    ...init,
    // A POST carries the client secret, so it is never forwarded to wherever a redirect points.
    redirect: init === undefined ? "follow" : "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  // Only the discovery document and the token answer are read; a page such as the provider's sign-in or error page is not.
  const isJson = (response.headers.get("content-type") ?? "").includes("json");
  if (!isJson) {
    response.body?.cancel().catch(() => undefined);
  }
  return {
    status: response.status,
    url: response.url,
    body: isJson ? (await response.text()).slice(0, 100_000) : "",
  };
};

/**
 * `zitadel test sign-in` — check a sign-in provider's setup before the first
 * sign-in.
 *
 * Runs the {@link IDP_CHECKS} battery against one connection: the provider's
 * discovery document, then what the provider itself says about the client, the
 * callback URI and (when supplied) the client secret. Each check prints as it
 * finishes. A check that fails makes the command fail; one that could not tell
 * is shown as skipped and never counted as a pass.
 */
export default class TestSignIn extends BaseCommand {
  static override description = "Check that a sign-in provider is set up correctly.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> test sign-in --provider google",
    "echo $GOOGLE_CLIENT_SECRET | <%= config.bin %> test sign-in --provider google --client-secret-stdin",
    "<%= config.bin %> test sign-in --provider google --live",
  ];
  static override flags = {
    provider: nonBlankString({
      description: "Connection to check. Defaults to every connection the Project has.",
    }),
    "client-secret-stdin": Flags.boolean({
      description: "Read the provider's client secret, to check it, from stdin.",
    }),
    live: Flags.boolean({
      description:
        "After the checks, sign in through a browser and watch the runtime's log. Off by default.",
    }),
    timeout: Flags.integer({
      description: "Seconds to wait for the browser sign-in.",
      default: DEFAULT_TIMEOUT_SECONDS,
      min: 1,
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(TestSignIn);
    const live = flags.live;
    if (live) {
      const runtime = await readRuntimeMetadata(
        resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined),
      );
      await this.toMeta(flags, {
        resolveServer: false,
        source: runtime?.server_url ?? DEFAULT_LOCAL_SERVER_URL,
      });
    } else {
      await this.toMeta(flags);
    }
    const { cwd } = this.meta;
    const server = LocalServer.at(cwd, { cliVersion: this.meta.cliVersion });
    if (live) {
      await this.requireRunning(server);
    }

    const connections = await this.connections(cwd, flags.provider);
    if (connections.length > 1 && (live || flags["client-secret-stdin"])) {
      throw new ZitadelError(
        "E_VALIDATION",
        `${live ? "A live sign-in" : "A client secret"} belongs to one provider`,
        { hint: `Name one with --provider: ${connections.map(slugOf).join(", ")}` },
      );
    }
    const projectIssuer = readDevelopmentIssuer(await readZitadelConfig(cwd));
    if (projectIssuer === undefined) {
      throw new ZitadelError("E_VALIDATION", "zitadel.json names no development issuer", {
        hint: "The callback URI is built from it; run zitadel setup first.",
      });
    }
    const suppliedSecret = await this.input({
      kind: "secret",
      name: "client secret",
      message: "Client secret",
      flag: "--client-secret-stdin",
      stdin: flags["client-secret-stdin"],
      optional: true,
      parse: (raw) => ({ ok: true, value: raw.trim() }),
    });

    const providers = await connections.reduce<Promise<readonly ProviderReport[]>>(
      async (done, connection) => [
        ...(await done),
        await this.checkProvider({
          connection,
          projectIssuer,
          server,
          live,
          timeoutSeconds: flags.timeout,
          clientSecret: suppliedSecret === "" ? undefined : suppliedSecret,
          heading: connections.length > 1,
        }),
      ],
      Promise.resolve([]),
    );

    const total = (key: "passed" | "warned" | "failed" | "skipped") =>
      providers.reduce((sum, report) => sum + report[key], 0);
    const data = {
      title: "Sign-in provider checks.",
      passed: total("passed"),
      warned: total("warned"),
      failed: total("failed"),
      skipped: total("skipped"),
      providers,
    };
    const summary = `${data.passed} passed, ${data.warned} warned, ${data.failed} failed, ${data.skipped} skipped`;
    const broken = providers.filter((report) => report.failed > 0);
    const [first] = broken;
    if (first !== undefined) {
      const recovery = first.checks.find((check) => check.status === "fail")?.recovery;
      throw new ZitadelError(
        "E_VALIDATION",
        `Sign-in checks failed for ${broken.map((report) => report.provider).join(", ")}: ${summary}`,
        {
          hint:
            recovery === undefined
              ? undefined
              : escaped(providers.length > 1 ? `${first.provider}: ${recovery}` : recovery),
          details: data,
        },
      );
    }
    return this.emit({
      status: "ok",
      data,
      pretty: live
        ? `\n${summary}. A sign-in that created a user left it in the project.`
        : `\n${summary}. A real sign-in is the only check that proves the whole journey: add --live to try one.`,
    });
  }

  /** Runs the battery for one connection, printing each check as it finishes. */
  private async checkProvider(options: {
    readonly connection: ConnectionFile;
    readonly projectIssuer: string;
    readonly server: LocalServer;
    readonly live: boolean;
    readonly timeoutSeconds: number;
    readonly clientSecret: string | undefined;
    readonly heading: boolean;
  }): Promise<ProviderReport> {
    const { connection, projectIssuer, server, live, clientSecret } = options;
    const { cwd } = this.meta;
    const slug = slugOf(connection);
    const oidc = isObject(connection.body.oidc) ? connection.body.oidc : {};
    const callbackUri = callbackUriFor(projectIssuer, slug);
    if (live) {
      await this.requireSecretVariable(cwd, oidc.client_secret);
      await this.requireApplied(cwd);
    }

    if (options.heading) {
      consola.log(`\n${pc.bold(slug)}`);
    } else if (process.stdout.isTTY) {
      consola.info(`Provider  ${slug}`);
      consola.info(`Callback  ${callbackUri}`);
      consola.log("");
    }
    const catalogId = IDP_PROVIDERS.find((id) => id === slug);
    const results = await runChecks(
      IDP_CHECKS,
      idpContext({
        slug,
        issuer: typeof oidc.issuer === "string" ? oidc.issuer : "",
        clientId: await this.clientId(cwd, oidc.client_id),
        clientSecret,
        scopes: stringsIn(oidc.scopes),
        claims: [
          ...stringsIn(connection.body.claim_mapping),
          ...stringsIn(connection.body.verified_claims),
        ],
        callbackUri,
        tokenAuthMethod:
          oidc.token_endpoint_auth_method === "client_secret_post"
            ? "client_secret_post"
            : "client_secret_basic",
        endpoints: endpointsOf(oidc),
        consoleUrl: catalogId === undefined ? undefined : idpProvider(catalogId).consoleUrl,
        probes: PROVIDER_PROBES.get(slug),
        request: send,
        ...(live
          ? {
              live: {
                loginUrl: `${projectIssuer.replace(/\/$/, "")}/login`,
                timeoutMs: options.timeoutSeconds * 1000,
                open: async (url) => {
                  await openInBrowser(url);
                },
                // Under --json consola is silent, so the login URL a person has to open would reach
                // nobody; stderr keeps stdout clean for the envelope and still shows it.
                say: (message) =>
                  this.jsonEnabled() ? process.stderr.write(`${message}\n`) : consola.log(message),
                watch: (signal) =>
                  watchSignInEvents(
                    async () => (await server.logs({ tail: LOG_TAIL })).logs,
                    wait,
                    LOG_POLL_MS,
                    signal,
                  ),
                sleep: wait,
              },
            }
          : {}),
      }),
      (result) => consola.log(line(result)),
    );
    const count = (status: CheckResult["status"]) =>
      results.filter((result) => result.status === status).length;
    return {
      provider: slug,
      callback_uri: callbackUri,
      passed: count("pass"),
      warned: count("warn"),
      failed: count("fail"),
      skipped: count("skipped"),
      checks: results,
    };
  }

  /** A sign-in needs the runtime it is watching, so a stopped one is refused before anything opens. */
  private async requireRunning(server: LocalServer): Promise<void> {
    if ((await server.status()).lifecycle !== "running") {
      throw new ZitadelError("E_VALIDATION", "The local Zitadel runtime is not running", {
        hint: "A live sign-in is watched through the runtime's log. Start it, or run without --live.",
        nextCommands: [publicCliCommand("start", this.meta.cliVersion)],
      });
    }
  }

  /** The client secret is write-only, so the most that can be known is that the project holds one. */
  private async requireSecretVariable(cwd: string, written: unknown): Promise<void> {
    const name = typeof written === "string" ? referencedVariable(written) : undefined;
    if (name === undefined) {
      return;
    }
    const { client, projectId } = await this.projectClient(cwd);
    const held = await client.getVariable(name, { project_id: projectId, kind: "primary" }).then(
      ({ primary }) => primary,
      (error: unknown) => {
        if (error instanceof ZitadelError && error.code === "E_NOT_FOUND") {
          return undefined;
        }
        throw error;
      },
    );
    if (held === undefined || typeof held !== "object") {
      throw new ZitadelError(
        "E_CREDENTIAL_MISSING",
        `The client secret variable ${name} is ${held === undefined ? "not set" : "not a secret"}`,
        {
          hint: `Publish it with: zitadel variables set ${name} --project-level --secret`,
          nextCommands: [
            publicCliCommand(
              `variables set ${name} --project-level --secret`,
              this.meta.cliVersion,
            ),
          ],
        },
      );
    }
  }

  /** What the runtime serves is what gets signed in with, so files it has not received are refused. */
  private async requireApplied(cwd: string): Promise<void> {
    const { client, projectId } = await this.projectClient(cwd);
    const plan = await buildSyncPlan(
      cwd,
      makeSyncers({ client, projectId, env: this.meta.env, cwd }),
      true,
    );
    const pending = enumeratePlanResources(plan).filter((change) =>
      SIGN_IN_KINDS.includes(change.kind),
    );
    if (pending.length > 0) {
      throw new ZitadelError(
        "E_VALIDATION",
        `${pending.length} change${pending.length === 1 ? "" : "s"} to the connection, schema or flow ${pending.length === 1 ? "is" : "are"} not applied yet`,
        {
          hint: `The sign-in would run against the old files: ${pending.map((change) => change.file).join(", ")}`,
          nextCommands: [publicCliCommand("apply", this.meta.cliVersion)],
          details: { pending },
        },
      );
    }
  }

  private async projectClient(cwd: string): Promise<{ client: ZitadelClient; projectId: string }> {
    const secret = await readZitadelSecret(cwd);
    return {
      client: createZitadelClient(
        { baseUrl: this.meta.source, token: secret.project_secret },
        { verbatim: true },
      ),
      projectId: secret.project_id,
    };
  }

  /** The connection named with --provider, or every connection the project has. */
  private async connections(
    cwd: string,
    provider: string | undefined,
  ): Promise<readonly ConnectionFile[]> {
    const files = await readConnectionFiles(cwd);
    const wanted =
      provider === undefined ? files : files.filter((file) => slugOf(file) === provider);
    if (wanted.length === 0) {
      throw new ZitadelError(
        "E_VALIDATION",
        `No connection${provider === undefined ? "" : ` named ${provider}`} in .zitadel/idps/`,
        {
          hint:
            files.length === 0
              ? "Add one with: zitadel auth-method sso enable --provider google"
              : `Connections: ${files.map(slugOf).join(", ")}`,
        },
      );
    }
    return wanted;
  }

  /** The client ID: written in the file, or a project variable the file references. */
  private async clientId(cwd: string, written: unknown): Promise<string> {
    if (typeof written !== "string" || written === "") {
      throw new ZitadelError("E_VALIDATION", "The connection has no oidc.client_id");
    }
    const name = referencedVariable(written);
    if (name === undefined) {
      return written;
    }
    const secret = await readZitadelSecret(cwd);
    const client = createZitadelClient({ baseUrl: this.meta.source, token: secret.project_secret });
    const { primary } = await client.getVariable(name, {
      project_id: secret.project_id,
      kind: "primary",
    });
    if (typeof primary !== "string") {
      throw new ZitadelError("E_NOT_FOUND", `Variable ${name} has no value`, {
        hint: `Publish it with: zitadel variables set ${name} --project-level`,
      });
    }
    return primary;
  }
}

/** The endpoints the connection names itself, which the server then uses without discovery. */
function endpointsOf(oidc: Record<string, unknown>) {
  const { authorization_endpoint: authorization, token_endpoint: token } = oidc;
  return typeof authorization === "string" && typeof token === "string"
    ? { authorization, token }
    : undefined;
}

/** What the checks said about one connection. */
type ProviderReport = {
  readonly provider: string;
  readonly callback_uri: string;
  readonly passed: number;
  readonly warned: number;
  readonly failed: number;
  readonly skipped: number;
  readonly checks: readonly CheckResult[];
};

const slugOf = (file: ConnectionFile) => String(file.body.slug);

/** The string members of an array or the string values of an object; anything else has none. */
function stringsIn(value: unknown): string[] {
  return typeof value === "object" && value !== null
    ? Object.values(value).filter((member): member is string => typeof member === "string")
    : [];
}

/**
 * One result for a terminal. A message can carry what the provider's discovery
 * document said, which nobody here vouches for, so a control character in it is
 * shown escaped instead of reaching the terminal.
 */
function line({ status, title, message, recovery }: CheckResult): string {
  const row = `  ${GLYPHS[status]} ${title.padEnd(TITLE_WIDTH)}${pc.dim(escaped(message))}`;
  return recovery === undefined ? row : `${row}\n    ${pc.cyan("→")} ${escaped(recovery)}`;
}

const escaped = (text: string) => escapeControlCharacters(text, { keepLayout: false });
