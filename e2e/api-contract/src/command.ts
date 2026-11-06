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
}

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
    const environment: Record<string, string> = {};
    Object.entries(this.input.headers).forEach(([name, value], index) => {
      environment[`HEADER_${String(index)}`] = `${name}: ${value}`;
    });
    Object.values(this.input.schemes).forEach((credential, index) => {
      environment[`SCHEME_${String(index)}`] = credential.value;
    });
    return environment;
  }

  /** The `schemathesis.toml` that applies the scheme credentials, or nothing when there are none. */
  config(): string | undefined {
    const entries = Object.entries(this.input.schemes);
    if (entries.length === 0) {
      return undefined;
    }
    const tables = entries.map(([name, credential], index) => {
      const key = credential.kind === "bearer" ? "bearer" : "api_key";
      return `[auth.openapi.${JSON.stringify(name)}]\n${key} = "\${SCHEME_${String(index)}}"\n`;
    });
    return tables.join("\n");
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
      this.config() === undefined
        ? "schemathesis run /work/openapi.json"
        : `schemathesis --config-file ${CONFIG_PATH} run /work/openapi.json`,
      `--url ${SchemathesisCommand.quote(this.input.url)}`,
      ...headers,
      ...operations,
      `--checks ${this.input.checks.join(",")}`,
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
