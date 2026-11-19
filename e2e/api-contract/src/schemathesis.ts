import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { GenericContainer, type StartedTestContainer } from "testcontainers";

import { SchemathesisCommand, type CommandInput } from "./command";
import { SchemathesisReport } from "./report";

/**
 * The Schemathesis release the lane runs. Pinned, never `latest`: a new
 * release adds checks, and a lane whose failures change without a change to
 * the API is a lane nobody trusts.
 */
export const SCHEMATHESIS_IMAGE = "schemathesis/schemathesis:4.33.4";

/**
 * The name the container reaches the host's loopback services under. Docker
 * Desktop defines it; on Linux the `host-gateway` mapping below adds it.
 */
const HOST_ALIAS = "host.docker.internal";

/** How long the idle container stays up if a run never stops it. */
const IDLE_SECONDS = 4 * 60 * 60;

export interface SchemathesisRun {
  /** Schemathesis's exit status: 0 when every check passed, 1 when one failed. */
  exitCode: number;
  /** Everything it printed, for the failure message of a run that crashed. */
  log: string;
  /** The report it wrote, as text. */
  reportText: string;
  report: SchemathesisReport;
}

/**
 * One Schemathesis container, started idle with the spec and hooks mounted.
 * Each `run` is a command executed inside it, so any number of runs share the
 * one container and may overlap.
 */
export class Schemathesis {
  private readonly container: StartedTestContainer;
  private readonly workDir: string;

  private constructor(container: StartedTestContainer, workDir: string) {
    this.container = container;
    this.workDir = workDir;
  }

  /**
   * Starts the container.
   *
   * @param workDir - a scratch folder the container mounts; the spec and hooks are put in it and each run's report is read from it.
   * @param spec - the OpenAPI document, as the server serves it.
   */
  static async start(workDir: string, spec: string): Promise<Schemathesis> {
    await mkdir(workDir, { recursive: true });
    // The image runs as an unprivileged user whose id is not the host user's, so
    // on Linux it can only write into a folder everyone can write to.
    await chmod(workDir, 0o777);
    // Written as the JSON it parses to, so only a document that is valid JSON
    // reaches the file, whatever the server answered.
    await writeFile(join(workDir, "openapi.json"), JSON.stringify(JSON.parse(spec)));
    await copyFile(join(import.meta.dirname, "..", "hooks.py"), join(workDir, "hooks.py"));
    const container = await new GenericContainer(SCHEMATHESIS_IMAGE)
      .withEntrypoint(["sleep", String(IDLE_SECONDS)])
      .withBindMounts([{ source: workDir, target: "/work", mode: "rw" }])
      .withExtraHosts([{ host: HOST_ALIAS, ipAddress: "host-gateway" }])
      .start();
    return new Schemathesis(container, workDir);
  }

  /** The API's base URL as the container reaches it. */
  static fromContainer(baseUrl: string): string {
    const url = new URL(baseUrl);
    url.hostname = HOST_ALIAS;
    return url.toString().replace(/\/$/, "");
  }

  /**
   * Runs one command in the container and reads the report it wrote.
   *
   * @param input - the command; its `url` is the address the host sees, which is rewritten for the container.
   */
  async run(input: CommandInput): Promise<SchemathesisRun> {
    const command = new SchemathesisCommand({
      ...input,
      url: Schemathesis.fromContainer(input.url),
    });
    const directory = join(this.workDir, input.name);
    await mkdir(directory, { recursive: true });
    await chmod(directory, 0o777);
    await writeFile(join(directory, "schemathesis.toml"), command.config());
    const result = await this.container.exec(command.toArgs(), { env: command.environment() });
    const reportText = await this.readReport(directory, result.exitCode, result.output);
    return {
      exitCode: result.exitCode,
      log: result.output,
      reportText,
      report: SchemathesisReport.parse(reportText),
    };
  }

  async stop(): Promise<void> {
    await this.container.stop();
  }

  private async readReport(directory: string, exitCode: number, log: string): Promise<string> {
    try {
      return await readFile(join(directory, "report.json"), "utf8");
    } catch {
      throw new Error(
        `Schemathesis wrote no report (exit ${String(exitCode)}). Its output:\n${log}`,
      );
    }
  }
}
