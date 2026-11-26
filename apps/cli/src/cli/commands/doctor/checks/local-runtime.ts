import { errorMessage } from "@/lib/errors";
import { isErrno } from "@/lib/errno";
import {
  BinaryLauncher,
  DockerLauncher,
  type DockerResult,
  LocalRuntime,
  type LocalServers,
  type ManagedRuntimeProcess,
  type RuntimeBackend,
  type RuntimeMetadata,
  type TcpListener,
  type WritablePathProbe,
  assertLocalStateWritable,
  checkLocalServerHealth,
  listenersForPort,
} from "@/lib/server";
import type { Suggest } from "@/lib/suggestion";

import { AbstractSanityCheck, CheckFailure, type CheckOutcome } from "./types";

/**
 * The checks of the local runtime `doctor` runs against the server in
 * `runtimeDir` (the directory holding its `.zitadel/local` state, or the
 * current directory when no server was started yet).
 *
 * The probes of this machine are protected methods, so a test answers for the
 * machine by overriding them in a subclass.
 */
export class LocalRuntimeChecks {
  private readonly runtimeDir: string;
  private readonly runtime: RuntimeMetadata | undefined;
  private readonly backend: RuntimeBackend;
  private readonly image: string;
  private readonly port: number;
  private readonly servers: LocalServers;
  private readonly suggest: Suggest;
  private readonly inheritedFrom: string | undefined;

  /**
   * @param runtimeDir - The directory holding the server's state, or the current one.
   * @param runtime - The server's record, if one was started.
   * @param backend - The backend a start would use.
   * @param image - The Docker image a start would use.
   * @param port - The port a start would use.
   * @param servers - The local servers running on this machine.
   * @param suggest - Renders a command a message suggests.
   * @param inheritedFrom - The parent folder that started the server, when it was not this one.
   */
  constructor(
    runtimeDir: string,
    runtime: RuntimeMetadata | undefined,
    backend: RuntimeBackend,
    image: string,
    port: number,
    servers: LocalServers,
    suggest: Suggest,
    inheritedFrom?: string,
  ) {
    this.runtimeDir = runtimeDir;
    this.runtime = runtime;
    this.backend = backend;
    this.image = image;
    this.port = port;
    this.servers = servers;
    this.suggest = suggest;
    this.inheritedFrom = inheritedFrom;
  }

  /**
   * Runs every check of the local runtime for the backend a start would use.
   *
   * @returns One outcome per check, in display order.
   */
  async run(): Promise<CheckOutcome[]> {
    const { runtimeDir, runtime, backend, image, port } = this;
    const before: CheckOutcome[] = [];
    if (backend === "binary") {
      before.push(
        await AbstractSanityCheck.attempt(
          "server-binary",
          "Server npm package is available",
          () => {
            return Promise.resolve(`@zitadel/server ${this.binaryVersion()} is available`);
          },
        ),
      );
    } else {
      const unreachable = (detail: string): string => {
        const said = detail.trim();
        const because = said ? ` (${said})` : "";
        return `Docker is not reachable${because}; managed local runtime commands need Docker, but remote or cloud setup can continue with --server <url>.`;
      };
      const docker = await AbstractSanityCheck.attempt(
        "docker-cli",
        "Docker is reachable",
        async () => {
          try {
            const result = await this.docker();
            if (result.status !== 0) {
              throw new CheckFailure(unreachable(result.stderr || "docker version failed"));
            }
            return `Docker engine ${result.stdout.trim() || "available"}`;
          } catch (error) {
            if (isErrno(error, "ENOENT") || isErrno(error, "EACCES")) {
              throw new CheckFailure(unreachable(errorMessage(error)), undefined, { cause: error });
            }
            throw error;
          }
        },
        "warn",
      );
      before.push(docker);
      if (docker.status === "pass") {
        before.push(
          await AbstractSanityCheck.attempt(
            "image",
            `Image ${image} is available`,
            async () => {
              try {
                const source = await this.imageSource(image);
                if (source === "local") {
                  return `Image ${image} is available locally`;
                } else {
                  return `Image ${image} is available from the registry`;
                }
              } catch (error) {
                const detail = errorMessage(error).trim();
                const suffix = detail ? ` (${detail})` : "";
                const message = `Image ${image} is not available to Docker${suffix}; ${this.suggest({ id: "start" })} may need a pull or a different image.`;
                throw new CheckFailure(message, undefined, { cause: error });
              }
            },
            "warn",
          ),
        );
      } else {
        before.push({
          name: "image",
          status: "warn",
          message: "Skipped image check because Docker is not reachable.",
        });
      }
    }

    const stateDirectory = await AbstractSanityCheck.attempt(
      "state-dir",
      "Local state directory is writable",
      async () => {
        const probe = await this.canWrite(runtimeDir);
        if (probe.checkedPath === probe.targetPath) {
          return `${probe.targetPath} is writable`;
        } else {
          return `${probe.targetPath} can be created (${probe.checkedPath} is writable)`;
        }
      },
      "warn",
    );

    const portAvailable = await AbstractSanityCheck.attempt(
      "port",
      `Port ${String(port)} is available`,
      async () => {
        if (runtime?.port === port && (await this.isHealthy(runtime.server_url))) {
          return `${runtime.server_url} is already healthy`;
        }
        const listeners = await this.listeners(port);
        if (listeners.length > 0) {
          const holders = listeners
            .map((listener) => {
              return [
                listener.command ?? "unknown",
                listener.pid ? `pid ${String(listener.pid)}` : undefined,
              ]
                .filter(Boolean)
                .join(" ");
            })
            .join(", ");
          throw new CheckFailure(`Port ${String(port)} is already in use by ${holders}`, {
            port,
            server_url: LocalRuntime.urlOf(port),
            listeners,
          });
        }
        return `Port ${String(port)} is available`;
      },
    );

    const runtimeHealthy = await AbstractSanityCheck.attempt(
      "runtime",
      "Existing local runtime is healthy",
      async () => {
        if (!runtime) {
          return "No existing runtime metadata";
        }
        if (runtime.backend !== backend) {
          throw new CheckFailure(
            `Existing local runtime uses ${runtime.backend}; run start --runtime ${backend} to switch backends.`,
          );
        }
        if (!(await this.isHealthy(runtime.server_url))) {
          throw new CheckFailure(`${runtime.server_url} is not ready: /readyz did not answer ok`);
        }
        if (this.inheritedFrom === undefined) {
          return `${runtime.server_url} is healthy`;
        } else {
          return `${runtime.server_url} is healthy (server started in the parent folder ${this.inheritedFrom})`;
        }
      },
    );

    const discovery = await this.servers.current();
    const others: CheckOutcome[] = [];
    if (!discovery.supported) {
      others.push({
        name: "managed-runtime-processes",
        status: "warn",
        message: "Could not look for other local Zitadel servers on this machine.",
        details: {
          supported: false,
          error: discovery.error,
        },
      });
    } else {
      const processes: ReadonlyArray<ManagedRuntimeProcess> = discovery.processes.filter(
        (processInfo) => {
          if (runtime?.backend !== "binary") {
            return true;
          } else {
            return processInfo.pid !== runtime.pid && processInfo.ppid !== runtime.pid;
          }
        },
      );
      const details = {
        supported: true,
        scope: "host",
        processes,
      };
      if (processes.length === 0) {
        others.push({
          name: "managed-runtime-processes",
          status: "pass",
          message: "No other local Zitadel server is running on this machine.",
          details,
        });
      } else if (new Intl.PluralRules("en").select(processes.length) === "one") {
        others.push({
          name: "managed-runtime-processes",
          status: "warn",
          message: "1 other local Zitadel server is running on this machine.",
          details,
        });
      } else {
        others.push({
          name: "managed-runtime-processes",
          status: "warn",
          message: `${String(processes.length)} other local Zitadel servers are running on this machine.`,
          details,
        });
      }
    }
    return [...before, stateDirectory, portAvailable, runtimeHealthy, ...others];
  }

  /**
   * @returns The server release the install ships.
   * @throws When the install is broken.
   */
  protected binaryVersion(): string {
    return BinaryLauncher.assertAvailable();
  }

  /**
   * @param dir - The directory to check.
   * @returns Whether it, or the closest directory above it that exists, can be written.
   */
  protected canWrite(dir: string): Promise<WritablePathProbe> {
    return assertLocalStateWritable(dir);
  }

  /** @returns What the Docker daemon answers. */
  protected docker(): Promise<DockerResult> {
    return DockerLauncher.available();
  }

  /**
   * @param image - The image to find.
   * @returns Where it can be had from: this machine or a registry.
   */
  protected imageSource(image: string): Promise<"local" | "remote"> {
    return DockerLauncher.imageAvailable(image);
  }

  /**
   * @param serverUrl - The server to probe.
   * @returns Whether it answers its readiness probe.
   */
  protected isHealthy(serverUrl: string): Promise<boolean> {
    return checkLocalServerHealth(serverUrl);
  }

  /**
   * @param port - The TCP port.
   * @returns The processes listening on it on this machine.
   */
  protected listeners(port: number): Promise<readonly TcpListener[]> {
    return listenersForPort(port);
  }
}
