import {
  idpProvider,
  IDP_PROVIDERS,
  missingEndpoints,
  OIDC_ENDPOINTS,
  parseConnectionSlug,
  referencedVariable,
} from "@zitadel/config/idp";
import { consola } from "consola";

import { createZitadelClient, escapeControlCharacters } from "../../lib/api-client";
import {
  type CheckResult,
  IDP_CHECKS,
  idpContext,
  PROVIDER_PROBES,
  runChecks,
  type Send,
} from "../../lib/checks/idp";
import { toZitadelError, ZitadelError } from "../../lib/errors";
import { type ConnectionFile, callbackUriFor, readConnectionFiles } from "../../lib/idp";
import { isObject } from "../../lib/json";
import { wrapForBox } from "../../lib/box";
import { BaseCommand, CommandGroups, type JsonEnvelope, nonBlankString } from "../../lib/oclif";
import { reportWarning } from "../../lib/warnings";
import { publicCliCommand } from "../../lib/public-cli";
import { readDevelopmentIssuer, readZitadelConfig, readZitadelSecret } from "../../lib/project";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 1_000_000;
/** One GET, following redirects, bounded in time and in the body it keeps. */
const send: Send = async (url) => {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  // Only the discovery document is read; a page such as the provider's sign-in or error page is not.
  const isJson = (response.headers.get("content-type") ?? "").includes("json");
  if (!isJson) {
    // Not awaited: cancelling waits on the sender, and nothing here needs its answer.
    response.body?.cancel().catch(() => undefined);
  }
  return {
    status: response.status,
    url: response.url,
    body: isJson ? await readBounded(response, MAX_BODY_BYTES) : "",
  };
};

/**
 * The response body, read only up to `limit` bytes. A longer one is cancelled
 * and refused rather than cut short, since a truncated document would read as
 * malformed JSON and send the developer looking in the wrong place.
 */
async function readBounded(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return "";
  }
  const chunks: Uint8Array[] = [];
  const seen = { bytes: 0 };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    seen.bytes += value.byteLength;
    if (seen.bytes > limit) {
      // Not awaited: cancelling waits on the sender, which is the very thing being cut off.
      reader.cancel().catch(() => undefined);
      throw new Error(`${response.url} answered with more than ${limit} bytes`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * `zitadel test sign-in` — check a sign-in provider's setup before the first
 * sign-in.
 *
 * Runs the {@link IDP_CHECKS} battery against every connection the project
 * has, or the one named: the provider's discovery document, then what the
 * provider itself says about the client and the callback URI. None of it needs
 * the client secret, which the platform never reads back. Each check prints as
 * it finishes. A check that fails makes the command fail; one that could not
 * tell is shown as skipped and never counted as a pass.
 */
export default class TestSignIn extends BaseCommand {
  static override description = "Check that a sign-in provider is set up correctly.";
  static override group = CommandGroups.configuration;
  static override examples = ["<%= config.bin %> test sign-in --provider google"];
  static override flags = {
    provider: nonBlankString({
      description: "Connection to check. Defaults to every connection the Project has.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(TestSignIn);
    await this.toMeta(flags);
    const { cwd } = this.meta;
    const secret = await readZitadelSecret(cwd);
    consola.info(`Project   ${secret.project_id}`);
    consola.info(`Server    ${this.meta.source}`);
    const connections = await this.connections(cwd, flags.provider);
    const projectIssuer = readDevelopmentIssuer(await readZitadelConfig(cwd));
    if (projectIssuer === undefined) {
      throw new ZitadelError("E_VALIDATION", "zitadel.json names no development issuer", {
        hint: "The callback URI is built from it; run zitadel setup first.",
      });
    }
    const providers = await connections.reduce<Promise<readonly ProviderReport[]>>(
      async (done, connection) => [
        ...(await done),
        await this.checkProvider(connection, projectIssuer),
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
    consola.box({
      title: "Sign-in checks",
      message: wrapForBox(summaryOf(providers)),
      style: {
        padding: 1,
        borderStyle: "rounded",
        borderColor: data.failed > 0 ? "red" : data.warned > 0 ? "yellow" : "green",
      },
    });
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
          nextCommands: [
            publicCliCommand(`test sign-in --provider ${first.provider}`, this.meta.cliVersion),
          ],
        },
      );
    }
    const [only] = providers;
    return this.emit({
      status: "ok",
      data: {
        ...data,
        next_actions: ["Sign in once to be sure: these checks cannot prove the whole journey."],
        next_commands:
          only === undefined
            ? []
            : [publicCliCommand(`test sign-in --provider ${only.provider}`, this.meta.cliVersion)],
      },
    });
  }

  /** Runs the battery for one connection, printing each check as it finishes. */
  private async checkProvider(
    connection: ConnectionFile,
    projectIssuer: string,
  ): Promise<ProviderReport> {
    const { cwd } = this.meta;
    const slug = slugOf(connection);
    const oidc = isObject(connection.body.oidc) ? connection.body.oidc : {};
    const callbackUri = callbackUriFor(projectIssuer, slug);

    consola.start(`Checking ${slug}`);
    if (process.stdout.isTTY) {
      consola.info(`Callback  ${callbackUri}`);
    }
    // The profile follows the template the connection was made from, so a renamed Google
    // connection is still Google; the slug stays for the callback URI and the report.
    const kind = typeof connection.body.template === "string" ? connection.body.template : slug;
    const catalogId = IDP_PROVIDERS.find((id) => id === kind);
    const clientId = await this.clientId(cwd, oidc.client_id).then(
      (value) => ({ value }),
      (error: unknown) => ({ error: toZitadelError(error) }),
    );
    if ("error" in clientId && clientId.error.code === "E_CANCELLED") {
      // A cancelled request is the developer stopping the command, not this connection failing.
      throw clientId.error;
    }
    if ("error" in clientId) {
      // Only this connection is broken: say so as its result and go on to the others.
      const unresolved: CheckResult = {
        name: "client-id",
        title: "Client ID",
        status: "fail",
        message: clientId.error.message,
        ...(clientId.error.hint === undefined ? {} : { recovery: clientId.error.hint }),
      };
      report(unresolved);
      return {
        provider: slug,
        callback_uri: callbackUri,
        passed: 0,
        warned: 0,
        failed: 1,
        skipped: 0,
        checks: [unresolved],
      };
    }
    const results = await runChecks(
      IDP_CHECKS,
      idpContext({
        slug,
        idTokenMapping: oidc.id_token_mapping === true,
        missingEndpoints: missingEndpoints(oidc),
        configuredEndpoints: configuredEndpoints(oidc),
        issuer: typeof oidc.issuer === "string" ? oidc.issuer : "",
        clientId: clientId.value,
        scopes: stringList(oidc.scopes),
        claims: [
          ...stringsIn(connection.body.claim_mapping),
          ...stringsIn(connection.body.verified_claims),
        ],
        callbackUri,
        endpoints: endpointsOf(oidc),
        consoleUrl: catalogId === undefined ? undefined : idpProvider(catalogId).consoleUrl,
        probes: PROVIDER_PROBES.get(kind),
        request: send,
      }),
      report,
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

  /** The connection named with --provider, or every connection the project has. */
  private async connections(
    cwd: string,
    provider: string | undefined,
  ): Promise<readonly ConnectionFile[]> {
    const files = await readConnectionFiles(cwd);
    // A slug ends up in a command the output suggests running, so a file may not smuggle
    // anything into it; the reader only checks that a file holds an object.
    const unsafe = files.find((file) => !parseConnectionSlug(String(file.body.slug)).ok);
    if (unsafe !== undefined) {
      throw new ZitadelError("E_VALIDATION", "A connection file has a slug that is not valid", {
        hint: `Fix slug in ${unsafe.path}: it must match the connection schema's pattern`,
      });
    }
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
    if (typeof primary !== "string" || primary === "") {
      throw new ZitadelError("E_NOT_FOUND", `Variable ${name} has no value`, {
        hint: `Publish it with: zitadel variables set ${name} --project-level`,
      });
    }
    return primary;
  }
}

/** Every endpoint the connection writes down, so each can be held to the server's rule. */
function configuredEndpoints(oidc: Record<string, unknown>): Readonly<Record<string, string>> {
  return Object.fromEntries(
    OIDC_ENDPOINTS.flatMap((name) => {
      const value = oidc[name];
      return typeof value === "string" && value !== "" ? [[name, value] as const] : [];
    }),
  );
}

/** The authorization endpoint the connection names itself, which the server then uses without discovery. */
function endpointsOf(oidc: Record<string, unknown>) {
  const { authorization_endpoint: authorization } = oidc;
  // An empty string is unset, to the server as to the shared endpoint rule.
  return typeof authorization === "string" && authorization !== "" ? { authorization } : undefined;
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

/**
 * An array of strings as written, or nothing when it is anything else: the server cannot read a
 * list with a number in it or an object in its place, so it must not be quietly repaired.
 */
function stringList(value: unknown): string[] {
  return Array.isArray(value) && value.every((member) => typeof member === "string") ? value : [];
}

/** The string members of an array or the string values of an object; anything else has none. */
function stringsIn(value: unknown): string[] {
  return typeof value === "object" && value !== null
    ? Object.values(value).filter((member): member is string => typeof member === "string")
    : [];
}

/**
 * One result as a log line, in the CLI's own voice: a pass is a success, a
 * warning goes through `reportWarning` so `--json` keeps it, a failure is an
 * error with the line to act on under it, and a check that could not tell is
 * said so. A message can carry what the provider's discovery document said,
 * which nobody here vouches for, so a control character in it is shown escaped
 * instead of reaching the terminal.
 */
function report({ status, title, message, recovery }: CheckResult): void {
  const text = `${title}: ${escaped(message)}${recovery === undefined ? "" : `\n${escaped(recovery)}`}`;
  switch (status) {
    case "pass":
      consola.success(text);
      return;
    case "warn":
      reportWarning(text);
      return;
    case "fail":
      consola.error(text);
      return;
    case "skipped":
      consola.info(`Skipped ${text}`);
      return;
  }
}

/** What each provider's checks came to, and what to do next, for the closing box. */
function summaryOf(providers: readonly ProviderReport[]): string {
  const width = Math.max(...providers.map((report) => report.provider.length));
  const rows = providers.map((report) => {
    const counts = (
      [
        [report.passed, "passed"],
        [report.warned, "warned"],
        [report.failed, "failed"],
        [report.skipped, "skipped"],
      ] as const
    )
      .filter(([count]) => count > 0)
      .map(([count, word]) => `${count} ${word}`);
    return `${report.provider.padEnd(width)}  ${counts.join(", ")}`;
  });
  return [...rows, "", "These checks cannot prove a sign-in works: sign in once to be sure."].join(
    "\n",
  );
}

const escaped = (text: string) => escapeControlCharacters(text, { keepLayout: false });
