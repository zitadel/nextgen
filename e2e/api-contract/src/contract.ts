import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CHECKS, exemptionsFor, refusalsFor } from "./checks";
import type { CommandInput } from "./command";
import { CSRF_HEADER, type SessionCredential } from "./credentials";
import { compare } from "./order";
import type { Accounting, Failure } from "./report";
import type { SchemathesisRun } from "./schemathesis";
import type { OpenApiSpec } from "./spec";

/** What the suite reads about one Schemathesis command. */
export interface CommandRun {
  /** `all` for every operation but the logout, `logout` for it. */
  name: string;
  /** The `METHOD /path` names of the operations the command was asked to test, then its multi-step test. */
  operations: string[];
  /** How many operations the command was asked to test. */
  expected: number;
  /** What Schemathesis says it did with them. */
  accounting: Accounting;
  exitCode: number;
  /** The tail of what Schemathesis printed, for the failure message of a run that crashed. */
  log: string;
  complete: boolean;
  stopReason: string;
  errors: string[];
  failures: Failure[];
  /** How long the command took, in seconds. */
  seconds: number;
}

/** What Schemathesis files the failures of its multi-step phase under, which belong to no single operation. */
export const STATEFUL = "Stateful tests";

/** The phases that look at one operation at a time. */
const PER_OPERATION_PHASES = ["examples", "coverage", "fuzzing"];

export interface Runner {
  run(input: CommandInput): Promise<SchemathesisRun>;
}

/** Where the credentials come from; `Credentials` mints them on an instance. */
export interface CredentialSource {
  bearer(): CommandInput["schemes"];
  session(): Promise<SessionCredential>;
}

export interface ContractInput {
  spec: OpenApiSpec;
  /** The API's base URL as the host sees it, including the path prefix. */
  baseUrl: string;
  credentials: CredentialSource;
  runner: Runner;
  /** Where each command's raw report and output are kept for a person to read. */
  artifactsDir: string;
  /** Progress lines; the suite prints them, the unit tests drop them. */
  log: (message: string) => void;
}

/**
 * Waits for every promise, then throws the first failure. `Promise.all` would
 * throw at once and let the caller tear the container down under commands that
 * are still going.
 */
async function allSettled<T>(promises: readonly Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(promises);
  const failed = settled.find((result): result is PromiseRejectedResult => {
    return result.status === "rejected";
  });
  if (failed) {
    throw failed.reason;
  }
  return settled.map((result) => {
    return (result as PromiseFulfilledResult<T>).value;
  });
}

/**
 * Tests every operation of the spec with one Schemathesis container against
 * one instance, in two commands that run at the same time:
 *
 * - `all`: every operation but the logout. It holds the project secret for the
 *   bearer operations and a session for the cookie ones, and Schemathesis
 *   applies the credential each operation's own security entry asks for.
 * - `logout`: the one operation that ends the session its cookie belongs to, on
 *   a session of its own so it cannot sign the others out mid-run.
 */
export class Contract {
  private readonly input: ContractInput;

  constructor(input: ContractInput) {
    this.input = input;
  }

  async run(): Promise<CommandRun[]> {
    const { spec, credentials } = this.input;
    const logout = spec.operationsOf("logout");
    const rest = spec.operations().filter((operation) => {
      return operation.family !== "logout";
    });
    const sessionIds = spec.operationsOf("session").map((operation) => {
      return operation.id;
    });
    const [session, logoutSession] = await Promise.all([
      credentials.session(),
      credentials.session(),
    ]);
    const runs = await allSettled([
      this.command(
        "all",
        rest,
        {
          schemes: { ...credentials.bearer(), ...session.scheme },
          operationHeaders: Object.fromEntries(
            sessionIds.map((id) => {
              return [id, { [CSRF_HEADER]: session.csrfToken }];
            }),
          ),
        },
        true,
      ),
      this.command(
        "logout",
        logout,
        {
          schemes: logoutSession.scheme,
          operationHeaders: Object.fromEntries(
            logout.map((operation) => {
              return [operation.id, { [CSRF_HEADER]: logoutSession.csrfToken }];
            }),
          ),
        },
        false,
      ),
    ]);
    return runs.filter((run): run is CommandRun => {
      return run !== undefined;
    });
  }

  private async command(
    name: string,
    operations: ReturnType<OpenApiSpec["operations"]>,
    credential: Pick<CommandInput, "schemes" | "operationHeaders">,
    stateful: boolean,
  ): Promise<CommandRun | undefined> {
    if (operations.length === 0) {
      return undefined;
    }
    this.input.log(`${name}: ${String(operations.length)} operations`);
    const started = Date.now();
    const run = await this.input.runner.run({
      name,
      url: this.input.baseUrl,
      checks: CHECKS,
      exemptions: exemptionsFor(operations),
      refusals: refusalsFor(operations),
      operationIds: operations.map((operation) => {
        return operation.id;
      }),
      ...(stateful ? {} : { phases: PER_OPERATION_PHASES }),
      ...credential,
    });
    await this.keep(name, run);
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    this.input.log(`${name}: done in ${String(seconds)}s`);
    return {
      name,
      operations: [
        ...operations.map((operation) => {
          return operation.name;
        }),
        ...(stateful ? [STATEFUL] : []),
      ],
      expected: operations.length,
      accounting: run.report.accounting,
      exitCode: run.exitCode,
      log: run.log.split("\n").slice(-30).join("\n"),
      complete: run.report.complete,
      stopReason: run.report.stopReason,
      errors: run.report.errors,
      seconds,
      failures: run.report.failures().sort((a, b) => {
        return compare(a.operation, b.operation) || compare(a.check, b.check);
      }),
    };
  }

  /** Kept in the ignored test-output folder, so a failing run can be read in full and replayed. */
  private async keep(name: string, run: SchemathesisRun): Promise<void> {
    const directory = join(this.input.artifactsDir, name);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "report.json"), run.reportText);
    await writeFile(join(directory, "output.log"), run.log);
  }
}
