import { spawn } from "node:child_process";

import { ZitadelError } from "../errors";
import {
  CONTAINER_DATA_DIR,
  CONTAINER_HTTP_PORT,
  type ContainerIdentity,
  LAUNCH_CONTRACT,
  type RuntimeMetadata,
} from "./runtime";

export type DockerResult = {
  status: number;
  stdout: string;
  stderr: string;
};

export type DockerRunSpec = {
  containerName: string;
  image: string;
  port: number;
  dataDir: string;
  identity?: ContainerIdentity;
};

export function dockerRunArgs(spec: DockerRunSpec): string[] {
  const args = [
    "run",
    "--detach",
    "--name",
    spec.containerName,
    "--publish",
    `127.0.0.1:${spec.port}:${CONTAINER_HTTP_PORT}`,
    "--volume",
    `${spec.dataDir}:${CONTAINER_DATA_DIR}`,
    "--env",
    `NEXTGEN_SERVER_ADDRESS=:${CONTAINER_HTTP_PORT}`,
    "--env",
    `NEXTGEN_SERVER_DATA_DIR=${CONTAINER_DATA_DIR}`,
    // Browser-facing URLs (claim, dashboard) must use the host-visible port
    // published above, not the cloud default the server config falls back to.
    "--env",
    `NEXTGEN_SERVER_PUBLIC_BASE=http://localhost:${spec.port}`,
    // The platform project hosts the console's own sign-in and the personal
    // teams a claim attaches to; the binary launcher explains why the
    // CLI-owned runtime is the one place to enable it.
    "--env",
    "NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT=true",
  ];

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
  return args;
}

export async function runDocker(args: string[]): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
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

export async function streamDocker(args: string[]): Promise<void> {
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

export async function dockerAvailable(): Promise<DockerResult> {
  return runDocker(["version", "--format", "{{.Server.Version}}"]);
}

export async function pullImage(image: string): Promise<void> {
  await requireDocker(["pull", "--quiet", image], `Pull Docker image ${image}`);
}

export async function imageExists(image: string): Promise<boolean> {
  let result: DockerResult;
  const args = ["image", "inspect", image];
  try {
    result = await runDocker(args);
  } catch (error) {
    throw dockerError(`Inspect Docker image ${image}`, args, error);
  }
  return result.status === 0;
}

export async function imageAvailable(image: string): Promise<"local" | "remote"> {
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

export async function ensureImage(image: string): Promise<"local" | "pulled"> {
  if (await imageExists(image)) {
    return "local";
  }
  await pullImage(image);
  return "pulled";
}

export async function inspectContainer(containerName: string): Promise<{
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

export async function startContainer(spec: DockerRunSpec): Promise<string> {
  const args = dockerRunArgs(spec);
  const result = await requireDocker(args, "Start local Zitadel container");
  return result.stdout.trim();
}

export async function stopAndRemoveContainer(containerName: string): Promise<void> {
  const inspect = await inspectContainer(containerName);
  if (!inspect.exists) {
    return;
  }
  if (inspect.running) {
    await requireDocker(["stop", containerName], `Stop ${containerName}`);
  }
  await requireDocker(["rm", containerName], `Remove ${containerName}`);
}

export async function containerLogs(containerName: string, tail: number): Promise<string> {
  const result = await requireDocker(["logs", "--tail", String(tail), containerName], "Read logs");
  return result.stdout;
}

export async function followContainerLogs(containerName: string, tail: number): Promise<void> {
  await streamDocker(["logs", "--tail", String(tail), "--follow", containerName]);
}

export function currentUser(): { uid?: number; gid?: number } {
  const getuid = process.getuid;
  const getgid = process.getgid;
  if (typeof getuid !== "function") {
    return {};
  }
  const uid = getuid();
  const gid = typeof getgid === "function" ? getgid() : uid;
  return { uid, gid };
}

export function metadataFromStart(input: {
  cwdDataDir: string;
  cliVersion: string;
  containerName: string;
  containerId: string;
  image: string;
  port: number;
  serverUrl: string;
}): RuntimeMetadata {
  return {
    schema_version: 1,
    launch_contract: LAUNCH_CONTRACT,
    backend: "docker",
    container_name: input.containerName,
    container_id: input.containerId,
    image: input.image,
    port: input.port,
    server_url: input.serverUrl,
    data_dir: input.cwdDataDir,
    created_at: new Date().toISOString(),
    cli_version: input.cliVersion,
  };
}

export async function requireDocker(args: string[], action: string): Promise<DockerResult> {
  let result: DockerResult;
  try {
    result = await runDocker(args);
  } catch (error) {
    throw dockerError(action, args, error);
  }
  if (result.status !== 0) {
    throw dockerError(action, args, result);
  }
  return result;
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
