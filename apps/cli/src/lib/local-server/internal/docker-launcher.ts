import { spawn } from "node:child_process";

import { ZitadelError } from "../../errors";
import {
  EMPTY_ENV,
  EMPTY_SUMMARY,
  type EnvSummary,
  type ResolvedEnv,
  envSummary,
} from "../env-vars";
import {
  CONTAINER_DATA_DIR,
  CONTAINER_HTTP_PORT,
  type ContainerIdentity,
  type DockerRuntimeMetadata,
} from "../runtime";
import type { Launcher, StopOutcome } from "./lifecycle";

export type DockerResult = {
  status: number;
  stdout: string;
  stderr: string;
};

/** Where the local admin's bootstrap user document is mounted in the container. */
const CONTAINER_ADMIN_USER_FILE = "/var/lib/zitadel/bootstrap/admin-user.json";

export type DockerLaunchSpec = Readonly<{
  cliVersion: string;
  containerName: string;
  image: string;
  dataDir: string;
  identity?: ContainerIdentity;
  /**
   * Project variables, passed as bare `--env NAME` so Docker copies each
   * value from the docker client's environment; no value appears in argv.
   */
  env?: ResolvedEnv;
  /** Host path of the local admin's bootstrap user document. */
  userFile?: string;
}>;

/** The arguments of one `docker run`: the launch spec plus the port it is published on. */
export type DockerRunSpec = DockerLaunchSpec & Readonly<{ port: number }>;

/**
 * Everything about running the server in a container: the `docker run` it
 * starts, whether the container is alive, how it is stopped and removed, and its
 * logs. The container is named for the directory, so whatever holds that name is
 * this directory's.
 */
export class DockerLauncher implements Launcher<DockerRuntimeMetadata> {
  private readonly spec: DockerLaunchSpec;

  constructor(spec: DockerLaunchSpec) {
    this.spec = spec;
  }

  async launch(target: { port: number; serverUrl: string }): Promise<DockerRuntimeMetadata> {
    const { spec } = this;
    // A leftover of an earlier start (a record that was lost, a container that
    // stopped) is removed before the name is taken again.
    await DockerLauncher.remove(spec.containerName);
    await ensureImage(spec.image);
    const env = spec.env ?? EMPTY_ENV;
    const result = await requireDocker(
      DockerLauncher.runArgs({ ...spec, port: target.port }, env.injected),
      "Start local Zitadel container",
      env.values,
    );
    return DockerLauncher.metadata({
      cwdDataDir: spec.dataDir,
      cliVersion: spec.cliVersion,
      containerName: spec.containerName,
      containerId: result.stdout.trim(),
      image: spec.image,
      port: target.port,
      serverUrl: target.serverUrl,
      env: envSummary(env),
    });
  }

  async isAlive(record: DockerRuntimeMetadata): Promise<boolean> {
    return (await DockerLauncher.inspect(record.container_name)).running;
  }

  logTail(record: DockerRuntimeMetadata, lines: number): Promise<string> {
    return DockerLauncher.readLogs(record.container_name, lines);
  }

  async terminate(record: DockerRuntimeMetadata): Promise<StopOutcome> {
    return { status: (await DockerLauncher.remove(record.container_name)) ? "stopped" : "stale" };
  }

  static runArgs(spec: DockerRunSpec, envNames: readonly string[] = []): string[] {
    const args = [
      "run",
      "--detach",
      "--name",
      spec.containerName,
      "--publish",
      `127.0.0.1:${spec.port}:${CONTAINER_HTTP_PORT}`,
      "--volume",
      `${spec.dataDir}:${CONTAINER_DATA_DIR}`,
      // Project variables first: Docker takes the last value for a repeated
      // name, so the CLI's own settings below always win.
      ...envNames.flatMap((name) => ["--env", name]),
      "--env",
      `NEXTGEN_SERVER_ADDRESS=:${CONTAINER_HTTP_PORT}`,
      "--env",
      `NEXTGEN_SERVER_DATA_DIR=${CONTAINER_DATA_DIR}`,
      // Browser-facing URLs (claim, dashboard) must use the host-visible port
      // published above, not the cloud default the server config falls back to.
      "--env",
      `NEXTGEN_SERVER_PUBLIC_BASE=http://localhost:${spec.port}`,
    ];
    // The platform project and the local admin travel together: the admin is a
    // user of that project. A caller that wants a bare single-project instance
    // (test harnesses) starts without a user file and gets neither.
    if (spec.userFile) {
      args.push(
        "--env",
        "NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT=true",
        "--volume",
        `${spec.userFile}:${CONTAINER_ADMIN_USER_FILE}:ro`,
      );
    }

    if (spec.identity) {
      args.push(
        "--volume",
        `${spec.identity.passwdFile}:/etc/passwd:ro`,
        "--volume",
        `${spec.identity.groupFile}:/etc/group:ro`,
        "--user",
        `${spec.identity.uid}:${spec.identity.gid}`,
      );
    }

    args.push(spec.image);
    // The image's CMD is `--migrate`; passing arguments replaces it, so keep it.
    if (spec.userFile) {
      args.push("--migrate", "--user-file", CONTAINER_ADMIN_USER_FILE);
    }
    return args;
  }

  static metadata(input: {
    cwdDataDir: string;
    cliVersion: string;
    containerName: string;
    containerId: string;
    image: string;
    port: number;
    serverUrl: string;
    env?: EnvSummary;
  }): DockerRuntimeMetadata {
    return {
      schema_version: 1,
      backend: "docker",
      container_name: input.containerName,
      container_id: input.containerId,
      image: input.image,
      port: input.port,
      server_url: input.serverUrl,
      data_dir: input.cwdDataDir,
      created_at: new Date().toISOString(),
      cli_version: input.cliVersion,
      env: envSummary(input.env ?? EMPTY_SUMMARY),
    };
  }

  static available(): Promise<DockerResult> {
    return runDocker(["version", "--format", "{{.Server.Version}}"]);
  }

  /** Where the image can be had from: already here, or at the registry. Throws when neither. */
  static async imageAvailable(image: string): Promise<"local" | "remote"> {
    if (await imageExists(image)) {
      return "local";
    }

    const args = ["manifest", "inspect", image];
    let result: DockerResult;
    try {
      result = await runDocker(args);
    } catch (error) {
      throw dockerError(`Inspect Docker image ${image}`, args, error);
    }
    if (result.status === 0) {
      return "remote";
    }
    throw dockerError(`Inspect Docker image ${image}`, args, result);
  }

  static async inspect(containerName: string): Promise<{
    exists: boolean;
    running: boolean;
    id?: string;
    image?: string;
  }> {
    const result = await runDocker([
      "inspect",
      "--format",
      "{{.Id}} {{.State.Running}} {{.Config.Image}}",
      containerName,
    ]);
    if (result.status !== 0) {
      return { exists: false, running: false };
    }
    const [id, running, ...imageParts] = result.stdout.trim().split(/\s+/);
    return { exists: true, running: running === "true", id, image: imageParts.join(" ") };
  }

  /** Stops and removes the container. `false` when there was none to remove. */
  static async remove(containerName: string): Promise<boolean> {
    const inspect = await DockerLauncher.inspect(containerName);
    if (!inspect.exists) {
      return false;
    }
    if (inspect.running) {
      await requireDocker(["stop", containerName], `Stop ${containerName}`);
    }
    await requireDocker(["rm", containerName], `Remove ${containerName}`);
    return true;
  }

  static async readLogs(containerName: string, tail: number): Promise<string> {
    const result = await requireDocker(
      ["logs", "--tail", String(tail), containerName],
      "Read logs",
    );
    // `docker logs` replays each stream on its own: the server logs to stderr.
    return result.stdout + result.stderr;
  }

  static async followLogs(containerName: string, tail: number): Promise<void> {
    await streamDocker(["logs", "--tail", String(tail), "--follow", containerName]);
  }

  static currentUser(): { uid?: number; gid?: number } {
    const getuid = process.getuid;
    const getgid = process.getgid;
    if (typeof getuid !== "function") {
      return {};
    }
    const uid = getuid();
    const gid = typeof getgid === "function" ? getgid() : uid;
    return { uid, gid };
  }
}

async function runDocker(
  args: string[],
  env: Readonly<Record<string, string>> = {},
): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ status: code ?? 1, stdout, stderr });
    });
  });
}

async function streamDocker(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`docker ${args.join(" ")} exited with status ${code ?? 1}`));
      }
    });
  });
}

async function requireDocker(
  args: string[],
  action: string,
  env: Readonly<Record<string, string>> = {},
): Promise<DockerResult> {
  let result: DockerResult;
  try {
    result = await runDocker(args, env);
  } catch (error) {
    throw dockerError(action, args, error);
  }
  if (result.status !== 0) {
    throw dockerError(action, args, result);
  }
  return result;
}

async function imageExists(image: string): Promise<boolean> {
  let result: DockerResult;
  const args = ["image", "inspect", image];
  try {
    result = await runDocker(args);
  } catch (error) {
    throw dockerError(`Inspect Docker image ${image}`, args, error);
  }
  return result.status === 0;
}

async function ensureImage(image: string): Promise<"local" | "pulled"> {
  if (await imageExists(image)) {
    return "local";
  }
  await requireDocker(["pull", "--quiet", image], `Pull Docker image ${image}`);
  return "pulled";
}

function dockerError(action: string, args: string[], cause: unknown): ZitadelError {
  const details =
    cause && typeof cause === "object" && "stderr" in cause
      ? { command: ["docker", ...args], stderr: String((cause as { stderr?: unknown }).stderr) }
      : { command: ["docker", ...args], cause };
  return new ZitadelError("E_VALIDATION", `${action} failed`, {
    hint: "Check that Docker is installed, running, and reachable from this shell.",
    nextCommands: ["zitadel doctor"],
    details,
  });
}
