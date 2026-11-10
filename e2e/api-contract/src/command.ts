import type { Exemption } from "./checks";

/**
 * Fixed so a run generates the same requests every time. Without it a failure
 * one run finds can be missing from the next, and the baseline of known
 * failures could not be told apart from noise.
 */
export const SEED = 24184733292255574161660497485948756999n;

/** Most test cases Schemathesis generates for one operation. Raise it for a deeper, slower run. */
export const MAX_EXAMPLES = 25;

/**
 * Schemathesis fails a response slower than its request timeout (10s by
 * default). A fuzzed schema URL makes the server fetch an arbitrary host, which
 * can take that long, so the limit would make a run flaky. The server answers
 * such a fetch with its own timeout error well inside this.
 */
export const REQUEST_TIMEOUT_SECONDS = 60;

/** Where the container finds the hooks, which `Schemathesis.run` copies there. */
export const HOOKS_PATH = "/work/hooks.py";

/** Where the container finds the auth config. */
export const CONFIG_PATH = "/work/schemathesis.toml";

/** Where the sentinel line puts Schemathesis's own exit status. */
export const EXIT_MARKER = "schemathesis-exit:";

/** A credential for one of the spec's security schemes, which Schemathesis reads by scheme name. */
export interface SchemeCredential {
  kind: "bearer" | "cookie";
  value: string;
}

export interface CommandInput {
  /** The checks to apply, by name. */
  checks: readonly string[];
  /** The API's base URL as the container reaches it, including the path prefix. */
  url: string;
  /** Headers every request carries. Their values are read from the environment, never the command line. */
  headers: Record<string, string>;
  /**
   * Credentials by security scheme name. Schemathesis applies them where the
   * spec says (a bearer header, a cookie) and, because it knows which
   * parameter is the credential, does not generate a value for it, which a
   * fixed header cannot stop it doing.
   */
  schemes: Record<string, SchemeCredential>;
  /** The `operationId`s to test; the run is limited to them. */
  operationIds: readonly string[];
  /** Checks to switch off for an operation, which the exemptions in `checks.ts` explain. */
  exemptions?: readonly Exemption[];
  /**
   * Operations (`METHOD /path`) that may answer a valid-looking request with
   * a 400, because the rule behind it is not one a schema can state.
   */
  refusals?: readonly string[];
}

/**
 * What `positive_data_acceptance` expects by default, which leaves out 400: a
 * schema-valid request is not meant to be called bad. An operation in
 * `refusals` adds it.
 */
const ACCEPTED_STATUSES = ["2xx", "3xx", "401", "403", "404", "409", "429", "5xx"] as const;

/**
 * The shell line a container runs, and the environment it reads. Header values
 * (a bearer token, a session cookie) travel in the environment so they never
 * land in the process list or in Testcontainers' logs of the command.
 *
 * Schemathesis exits non-zero when it finds a failure, which is a result here
 * and not a failure to start. The shell therefore prints that status on a line
 * of its own and exits zero; the run is over when that line appears.
 */
export class SchemathesisCommand {
  private readonly input: CommandInput;

  constructor(input: CommandInput) {
    this.input = input;
  }

  /** The environment holding every header line and scheme credential. */
  environment(): Record<string, string> {
    // Python would otherwise write hooks.pyc into the mounted work directory as
    // root, and the run could not delete it afterwards.
    const environment: Record<string, string> = {
      SCHEMATHESIS_HOOKS: HOOKS_PATH,
      PYTHONDONTWRITEBYTECODE: "1",
    };
    Object.entries(this.input.headers).forEach(([name, value], index) => {
      environment[`HEADER_${String(index)}`] = `${name}: ${value}`;
    });
    Object.values(this.input.schemes).forEach((credential, index) => {
      environment[`SCHEME_${String(index)}`] = credential.value;
    });
    return environment;
  }

  /**
   * The `schemathesis.toml`: the checks to run, the scheme credentials, the
   * check exemptions of the operations under test, and the refusing operations
   * that may answer 400.
   */
  config(): string {
    const entries = Object.entries(this.input.schemes);
    const refusals = this.input.refusals ?? [];
    const tables = [this.checksTable()];
    entries.forEach(([name, credential], index) => {
      const key = credential.kind === "bearer" ? "bearer" : "api_key";
      tables.push(
        `[auth.openapi.${JSON.stringify(name)}]\n${key} = "\${SCHEME_${String(index)}}"\n`,
      );
    });
    (this.input.exemptions ?? []).forEach((exemption) => {
      tables.push(
        `[[operations]]\ninclude-operation-id = ${JSON.stringify(exemption.operationId)}\n` +
          `\n[operations.checks.${exemption.check}]\nenabled = false\n`,
      );
    });
    const statuses = [...ACCEPTED_STATUSES, "400"].map((status) => {
      return JSON.stringify(status);
    });
    for (const operation of refusals) {
      tables.push(
        `[[operations]]\ninclude-operation-id = ${JSON.stringify(operation)}\n\n` +
          `[operations.checks.positive_data_acceptance]\nexpected-statuses = [${statuses.join(", ")}]\n`,
      );
    }
    return tables.join("\n");
  }

  /**
   * Selects the checks in the config, not with `--checks`: that flag overrides
   * a per-operation exemption in the config, which would silently make every
   * exemption a no-op.
   */
  private checksTable(): string {
    const enabled = this.input.checks.map((check) => {
      return `[checks.${check}]\nenabled = true\n`;
    });
    return ["[checks]\nenabled = false\n", ...enabled].join("\n");
  }

  /** Single-quotes a value for the shell. */
  private static quote(value: string): string {
    return `'${value.replaceAll("'", `'\\''`)}'`;
  }

  toShell(): string {
    const headers = Object.keys(this.input.headers).map((_, index) => {
      return `-H "$HEADER_${String(index)}"`;
    });
    const operations = this.input.operationIds.map((id) => {
      return `--include-operation-id ${SchemathesisCommand.quote(id)}`;
    });
    return [
      `schemathesis --config-file ${CONFIG_PATH} run /work/openapi.json`,
      `--url ${SchemathesisCommand.quote(this.input.url)}`,
      ...headers,
      ...operations,
      `--request-timeout ${String(REQUEST_TIMEOUT_SECONDS)}`,
      `--seed ${String(SEED)}`,
      `--max-examples ${String(MAX_EXAMPLES)}`,
      "--report json --report-json-path /work/report.json",
      "--no-color",
      // The leading newline puts the marker on a line of its own even when
      // Schemathesis's output did not end with one.
      `; rc=$?; printf '\\n%s %s\\n' "${EXIT_MARKER}" "$rc"; exit 0`,
    ].join(" ");
  }
}
