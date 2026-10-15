import { createConnection, createServer } from "node:net";

import {
  type BinaryRunSpec,
  isRuntimeRunning,
  startBinaryRuntime,
  stopBinaryRuntime,
} from "./binary";
import {
  type ContainerIdentity,
  type DockerRuntimeMetadata,
  type BinaryRuntimeMetadata,
  type RuntimeMetadata,
  checkLocalServerHealth,
  readRuntimeMetadata,
  writeRuntimeMetadata,
} from "./runtime";
import {
  ensureImage,
  inspectContainer,
  metadataFromStart,
  startContainer,
  stopAndRemoveContainer,
} from "./docker";
import type { ResolvedEnv } from "./env-vars";
import type { HealthProbe, Launcher, PortProbe, ServerStore, StopOutcome } from "./server";

/**
 * A port is free when it can be bound and nothing answers on it. Binding alone
 * misses a server bound to one loopback address, which a wildcard bind can sit
 * beside, and connecting alone misses a socket that listens but does not accept
 * yet. `lsof` is not used: a listing that fails or times out reads as an empty
 * one, and an empty one reads as a free port.
 */
export class TcpPorts implements PortProbe {
  async isFree(port: number): Promise<boolean> {
    if (await this.answers(port)) {
      return false;
    }
    return this.canBind(port);
  }

  private answers(port: number): Promise<boolean> {
    const hosts = ["127.0.0.1", "::1"];
    return Promise.all(hosts.map((host) => connects(host, port))).then((results) =>
      results.some(Boolean),
    );
  }

  private canBind(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.listen({ port, exclusive: true }, () => probe.close(() => resolve(true)));
    });
  }
}

function connects(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: 500 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

export class HttpHealth implements HealthProbe {
  isHealthy(serverUrl: string): Promise<boolean> {
    return checkLocalServerHealth(serverUrl, 1000);
  }
}

/**
 * The folder's `.zitadel/local/runtime.json`, seen as the record of one backend.
 * A record the other backend wrote reads as nothing here: that server is not
 * this launcher's to manage.
 */
export class RuntimeFileStore<R extends RuntimeMetadata> implements ServerStore<R> {
  private readonly cwd: string;
  private readonly backend: R["backend"];

  constructor(cwd: string, backend: R["backend"]) {
    this.cwd = cwd;
    this.backend = backend;
  }

  async read(): Promise<R | undefined> {
    const runtime = await readRuntimeMetadata(this.cwd);
    return runtime?.backend === this.backend ? (runtime as R) : undefined;
  }

  write(record: R): Promise<void> {
    return writeRuntimeMetadata(this.cwd, record);
  }
}

/** Starts the `nextgen` binary itself, detached, and signals its process group to stop it. */
export class BinaryLauncher implements Launcher<BinaryRuntimeMetadata> {
  private readonly spec: Omit<BinaryRunSpec, "port" | "serverUrl">;

  constructor(spec: Omit<BinaryRunSpec, "port" | "serverUrl">) {
    this.spec = spec;
  }

  launch(target: { port: number; serverUrl: string }): Promise<BinaryRuntimeMetadata> {
    return startBinaryRuntime({ ...this.spec, ...target });
  }

  async isAlive(record: BinaryRuntimeMetadata): Promise<boolean> {
    return isRuntimeRunning(record.pid);
  }

  terminate(record: BinaryRuntimeMetadata): Promise<StopOutcome> {
    return stopBinaryRuntime(record.pid);
  }
}

export type DockerLauncherSpec = Readonly<{
  cliVersion: string;
  containerName: string;
  image: string;
  dataDir: string;
  identity?: ContainerIdentity;
  env?: ResolvedEnv;
  userFile?: string;
}>;

/** Runs the server in a container named for the folder, published on the chosen port. */
export class DockerLauncher implements Launcher<DockerRuntimeMetadata> {
  private readonly spec: DockerLauncherSpec;

  constructor(spec: DockerLauncherSpec) {
    this.spec = spec;
  }

  async launch(target: { port: number; serverUrl: string }): Promise<DockerRuntimeMetadata> {
    const { spec } = this;
    // The name is the folder's alone, so whatever holds it is a leftover of an
    // earlier start (a record that was lost, or a container that stopped).
    await stopAndRemoveContainer(spec.containerName);
    await ensureImage(spec.image);
    const { containerId, env } = await startContainer({
      containerName: spec.containerName,
      image: spec.image,
      port: target.port,
      dataDir: spec.dataDir,
      identity: spec.identity,
      env: spec.env,
      userFile: spec.userFile,
    });
    return metadataFromStart({
      cwdDataDir: spec.dataDir,
      cliVersion: spec.cliVersion,
      containerName: spec.containerName,
      containerId,
      image: spec.image,
      port: target.port,
      serverUrl: target.serverUrl,
      env,
    });
  }

  async isAlive(record: DockerRuntimeMetadata): Promise<boolean> {
    return (await inspectContainer(record.container_name)).running;
  }

  async terminate(record: DockerRuntimeMetadata): Promise<StopOutcome> {
    if (!(await inspectContainer(record.container_name)).exists) {
      return { status: "stale" };
    }
    await stopAndRemoveContainer(record.container_name);
    return { status: "stopped" };
  }
}
