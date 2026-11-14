import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { GenericContainer, Wait } from "testcontainers";

import { EXIT_MARKER, SchemathesisCommand, type SchemeCredential } from "./command";
import type { Exemption } from "./checks";
import { Completion } from "./completion";
import { SchemathesisReport } from "./report";

/**
 * The Schemathesis release the lane runs. Pinned, never `latest`: a new
 * release adds checks, and a lane whose failures change without a change to
 * the API is a lane nobody trusts.
 */
export const SCHEMATHESIS_IMAGE = "schemathesis/schemathesis:4.31.0";

/**
 * The name the container reaches the host's loopback services under. Docker
 * Desktop defines it; on Linux the `host-gateway` mapping below adds it.
 */
const HOST_ALIAS = "host.docker.internal";

/** How long one run may take before the lane gives up on it. */
const RUN_TIMEOUT_MS = 15 * 60_000;

/**
 * How long the output stream may trail the wait strategy. Testcontainers
 * reads the container's logs twice, once to see the marker and once for our
 * consumer, and the second can deliver the line a moment later.
 */
const OUTPUT_LAG_MS = 60_000;

export interface SchemathesisInput {
  /** A scratch folder for this run; the spec is written into it and the report read from it. */
  workDir: string;
  /** The OpenAPI document, as the server serves it. */
  spec: string;
  /** The API's base URL as the host sees it, including the path prefix. */
  baseUrl: string;
  /** Headers every request carries. */
  headers: Record<string, string>;
  /** Credentials by security scheme name. */
  schemes: Record<string, SchemeCredential>;
  /** The `operationId`s to test. */
  operationIds: readonly string[];
  /** The checks to apply, by name. */
  checks: readonly string[];
  /** The phases to run; all of them when absent. */
  phases?: readonly string[];
  /** The operations that may answer a valid-looking request with a 400. */
  refusals?: readonly string[];
  /** The checks to switch off for an operation. */
  exemptions?: readonly Exemption[];
}

export interface SchemathesisRun {
  /** Schemathesis's exit status: 0 when every check passed, 1 when one failed. */
  exitCode: number;
  /** Everything it printed, for the failure message of a run that crashed. */
  log: string;
  /** The report it wrote, as text. */
  reportText: string;
  report: SchemathesisReport;
}

/** Runs the pinned Schemathesis image once against a server on the host, through Testcontainers. */
export class Schemathesis {
  async run(input: SchemathesisInput): Promise<SchemathesisRun> {
    await mkdir(input.workDir, { recursive: true });
    // The image runs as an unprivileged user whose id is not the host user's, so
    // on Linux it can only write its report into a folder everyone can write to.
    await chmod(input.workDir, 0o777);
    await writeFile(join(input.workDir, "openapi.json"), input.spec);
    await copyFile(join(import.meta.dirname, "..", "hooks.py"), join(input.workDir, "hooks.py"));

    const url = new URL(input.baseUrl);
    url.hostname = HOST_ALIAS;
    const command = new SchemathesisCommand({
      url: url.toString().replace(/\/$/, ""),
      headers: input.headers,
      schemes: input.schemes,
      operationIds: input.operationIds,
      checks: input.checks,
      phases: input.phases,
      refusals: input.refusals,
      exemptions: input.exemptions,
    });
    await writeFile(join(input.workDir, "schemathesis.toml"), command.config());

    const completion = new Completion();
    const container = await this.start(input.workDir, command, completion);
    const deadline = new Deadline(OUTPUT_LAG_MS, () => {
      return `Schemathesis finished but its status never reached the output stream. Its output:\n${completion.log}`;
    });
    try {
      const exitCode = await Promise.race([completion.exitCode, deadline.expired]);
      const reportText = await this.readReport(input.workDir, exitCode, completion.log);
      return {
        exitCode,
        log: completion.log,
        reportText,
        report: SchemathesisReport.parse(reportText),
      };
    } finally {
      deadline.cancel();
      await container.stop();
    }
  }

  /**
   * Starts the container, which is ready when it has printed the exit marker
   * and so also when the run is over. A container that exits at once would
   * otherwise be started and gone before its output was read. The wait is
   * bounded by the startup timeout, and its failure carries what was printed.
   */
  private async start(workDir: string, command: SchemathesisCommand, completion: Completion) {
    try {
      return await new GenericContainer(SCHEMATHESIS_IMAGE)
        .withEntrypoint(["sh", "-c"])
        .withCommand([command.toShell()])
        .withEnvironment(command.environment())
        .withBindMounts([{ source: workDir, target: "/work", mode: "rw" }])
        .withExtraHosts([{ host: HOST_ALIAS, ipAddress: "host-gateway" }])
        .withLogConsumer((stream) => {
          stream.on("data", (chunk: Buffer | string) => {
            completion.push(chunk);
          });
        })
        .withWaitStrategy(Wait.forLogMessage(new RegExp(`^${EXIT_MARKER} \\d+\\s*$`, "m")))
        .withStartupTimeout(RUN_TIMEOUT_MS)
        .start();
    } catch (error) {
      throw new Error(`Schemathesis did not finish. Its output:\n${completion.log}`, {
        cause: error,
      });
    }
  }

  private async readReport(workDir: string, exitCode: number, log: string): Promise<string> {
    try {
      return await readFile(join(workDir, "report.json"), "utf8");
    } catch {
      throw new Error(
        `Schemathesis wrote no report (exit ${String(exitCode)}). Its output:\n${log}`,
      );
    }
  }
}

/**
 * A limit on a wait. Its timer is deliberately left referenced: while the lane
 * waits for the output stream to deliver the marker, nothing else keeps the
 * process alive, and Node would otherwise exit silently with the run
 * unfinished. It is cleared the moment the wait ends.
 */
class Deadline {
  readonly expired: Promise<never>;
  private timer: NodeJS.Timeout | undefined;

  constructor(milliseconds: number, message: () => string) {
    this.expired = new Promise<never>((_, reject) => {
      this.timer = setTimeout(() => {
        reject(new Error(message()));
      }, milliseconds);
    });
  }

  cancel(): void {
    clearTimeout(this.timer);
  }
}
