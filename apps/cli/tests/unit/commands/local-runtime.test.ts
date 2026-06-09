import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CONTAINER_DATA_DIR,
  localContainerName,
  localRuntimePaths,
  readRuntimeMetadata,
  writeRuntimeMetadata,
  type RuntimeMetadata,
} from "../../../src/lib/local-server/runtime";
import { parseJson, runCliForTest } from "../../helpers/run-cli";

const tempDirs: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("local runtime commands", () => {
  it("doctor --json passes with Docker mocked before app setup", async () => {
    const cwd = await tempProject("zitadel-doctor-");
    const fake = await fakeDocker();
    const port = await freePort();

    const result = await runCliForTest(["doctor", "--cwd", cwd, "--json", "--port", String(port)], {
      PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: fake.logPath,
    });

    expect(result.exitCode).toBe(0);
    const envelope = parseJson(result.stdout) as { status: string; data: { ok: boolean } };
    expect(envelope.status).toBe("ok");
    expect(envelope.data.ok).toBe(true);
  });

  it("doctor reports Docker-specific guidance when runtime prerequisites fail", async () => {
    const cwd = await tempProject("zitadel-doctor-fail-");
    const fake = await fakeDocker({ dockerAvailable: false });
    const port = await freePort();

    const result = await runCliForTest(["doctor", "--cwd", cwd, "--json", "--port", String(port)], {
      PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: fake.logPath,
    });

    expect(result.exitCode).toBe(3);
    const envelope = parseJson(result.stdout) as {
      status: string;
      hint: string;
      next_commands: string[];
    };
    expect(envelope.status).toBe("error");
    expect(envelope.hint).toContain("Docker is required");
    expect(envelope.hint).not.toContain("doctor --fix");
    expect(envelope.next_commands).toContain("docker version");
    expect(envelope.next_commands).toContain("zitadel doctor");
  });

  it("start --json starts the single-container runtime and writes metadata", async () => {
    const cwd = await tempProject("zitadel-start-");
    const fake = await fakeDocker();
    const serverUrl = await startHealthServer();
    const port = Number(new URL(serverUrl).port);

    const result = await runCliForTest(["start", "--cwd", cwd, "--json", "--port", String(port)], {
      PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: fake.logPath,
    });

    expect(result.exitCode).toBe(0);
    const envelope = parseJson(result.stdout) as {
      status: string;
      data: { urls: { api: string }; next_commands: string[] };
    };
    expect(envelope.status).toBe("ok");
    expect(envelope.data.urls.api).toBe(serverUrl);
    expect(envelope.data.next_commands).toContain(
      "npx @zitadel/cli@alpha setup --framework next --server local",
    );

    const runtime = await readRuntimeMetadata(cwd);
    expect(runtime?.server_url).toBe(serverUrl);
    await expect(readFile(join(cwd, ".gitignore"), "utf8")).resolves.toContain(".zitadel/local/");

    const dockerCalls = await readDockerCalls(fake.logPath);
    const runCall = dockerCalls.find((args) => args[0] === "run");
    expect(runCall).toBeDefined();
    expect(runCall?.join(" ")).toContain(`${localRuntimePaths(cwd).dataDir}:${CONTAINER_DATA_DIR}`);
    expect(runCall?.join(" ")).toContain(`NEXTGEN_SERVER_DATA_DIR=${CONTAINER_DATA_DIR}`);
    expect(runCall?.join(" ")).not.toContain("NEXTGEN_SERVER_ENCRYPTION_KEY");
  });

  it("start uses a prebuilt local image without pulling it", async () => {
    const cwd = await tempProject("zitadel-start-local-image-");
    const fake = await fakeDocker({ imageExists: true });
    const serverUrl = await startHealthServer();
    const port = Number(new URL(serverUrl).port);

    const result = await runCliForTest(
      ["start", "--cwd", cwd, "--json", "--port", String(port), "--image", "zitadel-nextgen:test"],
      {
        PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
        DOCKER_LOG: fake.logPath,
      },
    );

    expect(result.exitCode).toBe(0);
    const dockerCalls = await readDockerCalls(fake.logPath);
    expect(dockerCalls).toContainEqual(["image", "inspect", "zitadel-nextgen:test"]);
    expect(dockerCalls.some((args) => args[0] === "pull")).toBe(false);
    expect(dockerCalls.find((args) => args[0] === "run")?.at(-1)).toBe("zitadel-nextgen:test");
  });

  it("reset --force deletes local runtime data", async () => {
    const cwd = await tempProject("zitadel-reset-");
    const fake = await fakeDocker();
    const paths = localRuntimePaths(cwd);
    await mkdir(paths.dataDir, { recursive: true });
    await writeFile(join(paths.dataDir, "sample"), "data");
    await writeRuntimeMetadata(cwd, runtimeFor(cwd, "http://localhost:8080"));

    const result = await runCliForTest(["reset", "--cwd", cwd, "--json", "--force"], {
      PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: fake.logPath,
    });

    expect(result.exitCode).toBe(0);
    await expect(stat(paths.dataDir)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readRuntimeMetadata(cwd)).resolves.toBeUndefined();
  });
});

async function tempProject(prefix: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(cwd);
  return cwd;
}

async function fakeDocker(
  options: { dockerAvailable?: boolean; imageExists?: boolean } = {},
): Promise<{ binDir: string; logPath: string }> {
  const binDir = await mkdtemp(join(tmpdir(), "zitadel-fake-docker-"));
  tempDirs.push(binDir);
  const logPath = join(binDir, "docker.log");
  const dockerPath = join(binDir, "docker");
  await writeFile(
    dockerPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DOCKER_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "version") {
  if (${options.dockerAvailable === false ? "true" : "false"}) {
    console.error("Docker daemon is not running");
    process.exit(1);
  }
  console.log("29.0.0");
  process.exit(0);
}
if (args[0] === "pull") {
  console.log(args[args.length - 1]);
  process.exit(0);
}
if (args[0] === "image" && args[1] === "inspect") {
  process.exit(${options.imageExists === true ? "0" : "1"});
}
if (args[0] === "inspect") {
  process.exit(1);
}
if (args[0] === "run") {
  console.log("container-test-id");
  process.exit(0);
}
if (args[0] === "stop" || args[0] === "rm") {
  process.exit(0);
}
if (args[0] === "logs") {
  console.log("test logs");
  process.exit(0);
}
process.exit(0);
`,
  );
  await chmod(dockerPath, 0o755);
  return { binDir, logPath };
}

async function readDockerCalls(logPath: string): Promise<string[][]> {
  return (await readFile(logPath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

async function startHealthServer(): Promise<string> {
  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200).end("ok");
      return;
    }
    res.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "localhost", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("health server did not expose a TCP address");
  }
  return `http://localhost:${String(address.port)}`;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === "string") {
    throw new Error("free port probe did not expose a TCP address");
  }
  return address.port;
}

function runtimeFor(cwd: string, serverUrl: string): RuntimeMetadata {
  return {
    schema_version: 1,
    container_name: localContainerName(cwd),
    container_id: "container-test-id",
    image: "ghcr.io/zitadel/nextgen:test",
    port: Number(new URL(serverUrl).port),
    server_url: serverUrl,
    data_dir: localRuntimePaths(cwd).dataDir,
    created_at: "2026-06-09T00:00:00.000Z",
    cli_version: "0.0.0-test",
  };
}
