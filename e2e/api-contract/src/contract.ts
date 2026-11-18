import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CHECKS, exemptionsFor, refusalsFor } from "./checks";
import type { CommandInput } from "./command";
import { CSRF_HEADER, type SessionCredential } from "./credentials";
import { FailureDetails, type FailureDetail } from "./details";
import { compare } from "./order";
import { Shards } from "./shards";
import type { Accounting, Failure } from "./report";
import type { SchemathesisRun } from "./schemathesis";
import type { OpenApiSpec } from "./spec";

/** What the suite reads about one Schemathesis command. */
export interface CommandRun {
  /** `shard-N` for a share of the operations, `stateful` for the multi-step phase, `logout` for the logout. */
  name: string;
  /**
   * Whether the command's accounting says how many operations were tested. The
   * multi-step run repeats operations the shards already cover, so it does not.
   */
  counted: boolean;
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
  /** The failing requests Schemathesis printed, by operation name. */
  details: Record<string, FailureDetail[]>;
  /** How long the command took, in seconds. */
  seconds: number;
}

/** What Schemathesis files the failures of its multi-step phase under, which belong to no single operation. */
export const STATEFUL = "Stateful tests";

/** The phases that look at one operation at a time. */
const PER_OPERATION_PHASES = ["examples", "coverage", "fuzzing"];

/** The phase that chains operations together. */
const STATEFUL_PHASES = ["stateful"];

export interface Runner {
  run(input: CommandInput): Promise<SchemathesisRun>;
}

/** Where the credentials come from; `Credentials` mints them for one project. */
export interface CredentialSource {
  bearer(): CommandInput["schemes"];
  session(): Promise<SessionCredential>;
}

export interface ContractInput {
  spec: OpenApiSpec;
  /** The API's base URL as the host sees it, including the path prefix. */
  baseUrl: string;
  /** Makes a project of its own on the instance and returns the credentials it answers to. */
  project: () => Promise<CredentialSource>;
  /** How many shards the operations are dealt into, each run by a command of its own. */
  shards: number;
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
 * one instance, in commands that run at the same time, each on a project of
 * its own so that what one creates, changes or deletes is never seen by
 * another:
 *
 * - `shard-N`: a share of the operations but the logout, dealt by a hash of
 *   their names. Each holds the project secret for the bearer operations and a
 *   session for the cookie ones, and Schemathesis applies the credential each
 *   operation's own security entry asks for.
 * - `stateful`: the multi-step phase, which chains operations and so needs them
 *   all in one run.
 * - `logout`: the one operation that ends the session its cookie belongs to.
 */
export class Contract {
  private readonly input: ContractInput;

  constructor(input: ContractInput) {
    this.input = input;
  }

  async run(): Promise<CommandRun[]> {
    const { spec } = this.input;
    const logout = spec.operationsOf("logout");
    const rest = spec.operations().filter((operation) => {
      return operation.family !== "logout";
    });
    const runs = await allSettled([
      ...Shards.of(rest, this.input.shards).map((shard, index) => {
        return this.command(`shard-${String(index)}`, shard, true, PER_OPERATION_PHASES);
      }),
      this.command("stateful", rest, false, STATEFUL_PHASES),
      this.command("logout", logout, true, PER_OPERATION_PHASES),
    ]);
    return runs.filter((run): run is CommandRun => {
      return run !== undefined;
    });
  }

  /** A command's credentials: the project secret, a session of its own, and its CSRF token on the cookie operations. */
  private async credential(
    operations: ReturnType<OpenApiSpec["operations"]>,
  ): Promise<Pick<CommandInput, "schemes" | "operationHeaders">> {
    const project = await this.input.project();
    const session = await project.session();
    const cookie = new Set(
      operations
        .filter((operation) => {
          return operation.family === "session" || operation.family === "logout";
        })
        .map((operation) => {
          return operation.id;
        }),
    );
    return {
      schemes: { ...project.bearer(), ...session.scheme },
      operationHeaders: Object.fromEntries(
        [...cookie].map((id) => {
          return [id, { [CSRF_HEADER]: session.csrfToken }];
        }),
      ),
    };
  }

  private async command(
    name: string,
    operations: ReturnType<OpenApiSpec["operations"]>,
    counted: boolean,
    phases: readonly string[],
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
      phases,
      ...(await this.credential(operations)),
    });
    await this.keep(name, run);
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    this.input.log(`${name}: done in ${String(seconds)}s`);
    return {
      name,
      counted,
      operations: counted
        ? operations.map((operation) => {
            return operation.name;
          })
        : [STATEFUL],
      expected: operations.length,
      accounting: run.report.accounting,
      exitCode: run.exitCode,
      log: run.log.split("\n").slice(-30).join("\n"),
      complete: run.report.complete,
      stopReason: run.report.stopReason,
      errors: run.report.errors,
      details: FailureDetails.parse(run.log),
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
