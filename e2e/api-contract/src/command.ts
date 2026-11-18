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
 * How many requests Schemathesis sends at once within one command. It stays at
 * 1: the threads share the command's project, and with more, which requests
 * overlap changes from run to run, and so does what fails. The lane gets its
 * speed from running commands side by side, each on a project of its own (see
 * `Contract`). `API_CONTRACT_WORKERS` overrides it to measure that.
 */
export const WORKERS = Number(process.env.API_CONTRACT_WORKERS ?? 1);

/**
 * Schemathesis fails a response slower than its request timeout (10s by
 * default). A fuzzed schema URL makes the server fetch an arbitrary host, which
 * can take that long, so the limit would make a run flaky. The server answers
 * such a fetch with its own timeout error well inside this.
 */
export const REQUEST_TIMEOUT_SECONDS = 60;

/** Where the container finds the hooks, which the container's start copies there. */
export const HOOKS_PATH = "/work/hooks.py";

/** A credential for one of the spec's security schemes, which Schemathesis reads by scheme name. */
export interface SchemeCredential {
  kind: "bearer" | "cookie";
  value: string;
}

export interface CommandInput {
  /** The folder under `/work` this command keeps its config and report in. */
  name: string;
  /** The checks to apply, by name. */
  checks: readonly string[];
  /** The API's base URL as the container reaches it, including the path prefix. */
  url: string;
  /**
   * Headers an operation's requests carry, by `operationId`. A header meant for
   * one kind of operation (the CSRF token of the cookie operations) must not
   * ride on the others. Values are read from the environment, never the
   * command line.
   */
  operationHeaders?: Record<string, Record<string, string>>;
  /**
   * Credentials by security scheme name. Schemathesis applies them where the
   * spec says (a bearer header, a cookie) and, because it knows which
   * parameter is the credential, does not generate a value for it, which a
   * fixed header cannot stop it doing.
   */
  schemes: Record<string, SchemeCredential>;
  /** The `operationId`s to test; the run is limited to them. */
  operationIds: readonly string[];
  /** The phases to run (`examples`, `coverage`, `fuzzing`, `stateful`); all of them when absent. */
  phases?: readonly string[];
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
 * The Schemathesis command a container runs, and the files and environment it
 * reads. Credentials (a bearer token, a session cookie) travel in the
 * environment and the config reads them from there, so they never land in the
 * process list or in Testcontainers' logs of the command.
 *
 * Schemathesis exits non-zero when it finds a failure, which is a result here
 * and not a failure to start: the caller reads the exit status.
 */
export class SchemathesisCommand {
  private readonly input: CommandInput;

  constructor(input: CommandInput) {
    this.input = input;
  }

  /** The folder the command works in, inside the container. */
  get directory(): string {
    return `/work/${this.input.name}`;
  }

  /** Where the command writes its report, inside the container. */
  get reportPath(): string {
    return `${this.directory}/report.json`;
  }

  /** The config file the command reads, inside the container. */
  get configPath(): string {
    return `${this.directory}/schemathesis.toml`;
  }

  /** The environment holding every header value and scheme credential. */
  environment(): Record<string, string> {
    // Python would otherwise write hooks.pyc into the mounted work directory as
    // root, and the run could not delete it afterwards.
    const environment: Record<string, string> = {
      SCHEMATHESIS_HOOKS: HOOKS_PATH,
      PYTHONDONTWRITEBYTECODE: "1",
    };
    this.headerEntries().forEach((entry, index) => {
      environment[`HEADER_${String(index)}`] = entry.value;
    });
    Object.values(this.input.schemes).forEach((credential, index) => {
      environment[`SCHEME_${String(index)}`] = credential.value;
    });
    return environment;
  }

  /** Every per-operation header, in the order the environment numbers them. */
  private headerEntries(): { operationId: string; name: string; value: string }[] {
    return Object.entries(this.input.operationHeaders ?? {}).flatMap(([operationId, headers]) => {
      return Object.entries(headers).map(([name, value]) => {
        return { operationId, name, value };
      });
    });
  }

  /**
   * The `schemathesis.toml`: the checks to run, the scheme credentials, the
   * headers of single operations, the check exemptions of the operations under
   * test, and the refusing operations that may answer 400.
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
    this.headerEntries().forEach((entry, index) => {
      tables.push(
        `[[operations]]\ninclude-operation-id = ${JSON.stringify(entry.operationId)}\n\n` +
          `[operations.headers]\n${JSON.stringify(entry.name)} = "\${HEADER_${String(index)}}"\n`,
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

  /** The command and its arguments, which the container runs without a shell, so nothing needs quoting. */
  toArgs(): string[] {
    return [
      "schemathesis",
      "--config-file",
      this.configPath,
      "run",
      "/work/openapi.json",
      "--url",
      this.input.url,
      ...this.input.operationIds.flatMap((id) => {
        return ["--include-operation-id", id];
      }),
      "--request-timeout",
      String(REQUEST_TIMEOUT_SECONDS),
      "--seed",
      String(SEED),
      "--max-examples",
      String(MAX_EXAMPLES),
      "--workers",
      String(WORKERS),
      ...(this.input.phases ? ["--phases", this.input.phases.join(",")] : []),
      "--report",
      "json",
      "--report-json-path",
      this.reportPath,
      "--no-color",
    ];
  }
}
