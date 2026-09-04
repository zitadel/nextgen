import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CONTAINER_DATA_DIR,
  defaultLocalServerImageForCliVersion,
  localContainerName,
  localRuntimePaths,
  readRuntimeMetadata,
  writeRuntimeMetadata,
  type RuntimeMetadata,
} from "../../../src/lib/local-server/runtime";
import { expectedPublicCliCommand, parseJson, runCliForTest } from "../../helpers/run-cli";

const tempDirs: string[] = [];
const servers: Server[] = [];
const binaryPids: number[] = [];
const dockerHealthPidLogs: string[] = [];

afterEach(async () => {
  for (const logPath of dockerHealthPidLogs.splice(0)) {
    try {
      const pids = (await readFile(logPath, "utf8"))
        .split(/\r?\n/)
        .map((line) => Number.parseInt(line, 10))
        .filter((pid) => Number.isInteger(pid) && pid > 0);
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already stopped.
        }
      }
    } catch {
      // No fake Docker health process was started.
    }
  }
  for (const pid of binaryPids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already stopped by the command under test.
    }
  }
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
  it("doctor --json passes with the binary runtime before app setup", async () => {
    const cwd = await tempProject("zitadel-doctor-binary-");
    const fake = await fakeServerBinary();
    const port = await freePort();

    const result = await runCliForTest(["doctor", "--cwd", cwd, "--json", "--port", String(port)], {
      ZITADEL_SERVER_BINARY: fake.binPath,
    });

    expect(result.exitCode).toBe(0);
    const envelope = parseJson(result.stdout) as {
      status: string;
      data: { ok: boolean; runtime: string; checks: Array<{ name: string; status: string }> };
    };
    expect(envelope.status).toBe("ok");
    expect(envelope.data.ok).toBe(true);
    expect(envelope.data.runtime).toBe("binary");
    expect(envelope.data.checks.find((check) => check.name === "server-binary")).toMatchObject({
      status: "pass",
    });
    await expect(stat(join(cwd, ".zitadel"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("doctor --json passes with Docker mocked before app setup", async () => {
    const cwd = await tempProject("zitadel-doctor-");
    const fake = await fakeDocker();
    const port = await freePort();

    const result = await runCliForTest(
      ["doctor", "--cwd", cwd, "--json", "--runtime", "docker", "--port", String(port)],
      {
        PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
        DOCKER_LOG: fake.logPath,
      },
    );
    const defaultImage = await expectedDefaultImage();

    expect(result.exitCode).toBe(0);
    const envelope = parseJson(result.stdout) as { status: string; data: { ok: boolean } };
    expect(envelope.status).toBe("ok");
    expect(envelope.data.ok).toBe(true);
    await expect(stat(join(cwd, ".zitadel"))).rejects.toMatchObject({ code: "ENOENT" });

    const dockerCalls = await readDockerCalls(fake.logPath);
    expect(dockerCalls).toContainEqual(["image", "inspect", defaultImage]);
    expect(dockerCalls).toContainEqual(["manifest", "inspect", defaultImage]);
    expect(dockerCalls.some((args) => args[0] === "pull")).toBe(false);
  });

  it("doctor warns when Docker is unreachable before app setup", async () => {
    const cwd = await tempProject("zitadel-doctor-fail-");
    const fake = await fakeDocker({ dockerAvailable: false });
    const port = await freePort();

    const result = await runCliForTest(
      ["doctor", "--cwd", cwd, "--json", "--runtime", "docker", "--port", String(port)],
      {
        PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
        DOCKER_LOG: fake.logPath,
      },
    );

    expect(result.exitCode).toBe(0);
    const envelope = parseJson(result.stdout) as {
      status: string;
      warnings: string[];
      data: {
        ok: boolean;
        checks: Array<{ name: string; status: string; message: string }>;
        next_actions: string[];
        next_commands: string[];
      };
    };
    expect(envelope.status).toBe("ok");
    expect(envelope.data.ok).toBe(true);
    expect(envelope.warnings.join("\n")).toContain("Docker is not reachable");
    expect(envelope.data.next_actions.join("\n")).toContain("managed local runtime");
    expect(envelope.data.next_actions.join("\n")).toContain("--server <url>");
    expect(envelope.data.next_commands).toContain("docker version");
    expect(envelope.data.next_commands).toContain(expectedPublicCliCommand("doctor"));
    expect(envelope.data.checks.find((check) => check.name === "docker-cli")).toMatchObject({
      status: "warn",
    });
  });

  it("does not print duplicate warning lines in human doctor output", async () => {
    const cwd = await tempProject("zitadel-doctor-human-warn-");
    const fake = await fakeDocker({ dockerAvailable: false });
    const port = await freePort();

    const result = await runCliForTest(
      ["doctor", "--cwd", cwd, "--runtime", "docker", "--port", String(port)],
      {
        PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
        DOCKER_LOG: fake.logPath,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[warn] docker-cli:");
    expect(result.stdout).toContain("[warn] image:");
    expect(result.stdout).not.toContain("Warning: docker-cli:");
    expect(result.stdout).not.toContain("Warning: image:");
  });

  it("doctor warns about unavailable images without pulling", async () => {
    const cwd = await tempProject("zitadel-doctor-image-fail-");
    const fake = await fakeDocker({ imageAvailable: false });
    const port = await freePort();

    const result = await runCliForTest(
      [
        "doctor",
        "--cwd",
        cwd,
        "--json",
        "--runtime",
        "docker",
        "--port",
        String(port),
        "--image",
        "missing:test",
      ],
      {
        PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
        DOCKER_LOG: fake.logPath,
      },
    );

    expect(result.exitCode).toBe(0);
    const envelope = parseJson(result.stdout) as {
      status: string;
      warnings: string[];
      data: { ok: boolean; checks: Array<{ name: string; status: string; message: string }> };
    };
    expect(envelope.status).toBe("ok");
    expect(envelope.data.ok).toBe(true);
    expect(envelope.warnings.join("\n")).toContain("Image missing:test is not available");
    expect(envelope.data.checks.find((check) => check.name === "image")).toMatchObject({
      status: "warn",
    });

    const dockerCalls = await readDockerCalls(fake.logPath);
    expect(dockerCalls).toContainEqual(["image", "inspect", "missing:test"]);
    expect(dockerCalls).toContainEqual(["manifest", "inspect", "missing:test"]);
    expect(dockerCalls.some((args) => args[0] === "pull")).toBe(false);
  });

  it("doctor still fails when existing local runtime metadata is unhealthy", async () => {
    const cwd = await tempProject("zitadel-doctor-runtime-fail-");
    const fake = await fakeDocker();
    const port = await freePort();
    await writeRuntimeMetadata(cwd, runtimeFor(cwd, `http://localhost:${String(port)}`));

    const result = await runCliForTest(["doctor", "--cwd", cwd, "--json", "--port", String(port)], {
      PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: fake.logPath,
    });

    expect(result.exitCode).toBe(3);
    const envelope = parseJson(result.stdout) as {
      status: string;
      hint: string;
      next_commands: string[];
      details: { checks: Array<{ name: string; status: string }> };
    };
    expect(envelope.status).toBe("error");
    expect(envelope.hint).toContain("Existing local runtime metadata");
    expect(envelope.next_commands).toContain(expectedPublicCliCommand("start"));
    expect(envelope.next_commands).toContain(expectedPublicCliCommand("reset --force"));
    expect(envelope.details.checks.find((check) => check.name === "runtime")).toMatchObject({
      status: "fail",
    });
  });

  it("doctor fails with E_PORT_IN_USE when the requested local port is occupied", async () => {
    const cwd = await tempProject("zitadel-doctor-port-conflict-");
    const fake = await fakeServerBinary();
    const serverUrl = await startHealthServer();
    const port = Number(new URL(serverUrl).port);

    const result = await runCliForTest(["doctor", "--cwd", cwd, "--json", "--port", String(port)], {
      ZITADEL_SERVER_BINARY: fake.binPath,
    });

    expect(result.exitCode).toBe(5);
    const envelope = parseJson(result.stdout) as {
      code: string;
      details: { checks: Array<{ name: string; status: string; message: string }> };
      status: string;
    };
    expect(envelope.status).toBe("error");
    expect(envelope.code).toBe("E_PORT_IN_USE");
    expect(envelope.details.checks.find((check) => check.name === "port")).toMatchObject({
      status: "fail",
    });
  });

  it("doctor warns about other host-wide managed runtime processes and suggests stop --all", async () => {
    const cwd = await tempProject("zitadel-doctor-orphan-");
    const fake = await fakeServerBinary();
    const fakePs = await fakeProcessTable([
      {
        pid: 999_991,
        ppid: 1,
        command: "/usr/local/bin/node /tmp/app/node_modules/@zitadel/server/bin/zitadel-server.js",
      },
      { pid: 999_992, ppid: 1, command: "/usr/local/bin/node /tmp/not-zitadel.js" },
    ]);
    const port = await freePort();

    const result = await runCliForTest(["doctor", "--cwd", cwd, "--json", "--port", String(port)], {
      PATH: `${fakePs.binDir}:${process.env.PATH ?? ""}`,
      ZITADEL_SERVER_BINARY: fake.binPath,
    });

    expect(result.exitCode).toBe(0);
    const envelope = parseJson(result.stdout) as {
      data: {
        checks: Array<{ details?: { scope?: string }; message: string; name: string; status: string }>;
        next_commands?: string[];
      };
      warnings: string[];
    };
    expect(envelope.warnings.join("\n")).toContain("managed-runtime-processes");
    expect(envelope.data.next_commands).toContain(expectedPublicCliCommand("stop --all"));
    expect(
      envelope.data.checks.find((check) => check.name === "managed-runtime-processes"),
    ).toMatchObject({
      status: "warn",
      message: expect.stringContaining("other host-wide managed local runtime"),
      details: { scope: "host" },
    });
  });

  it("start fails before image work when Docker is unreachable", async () => {
    const cwd = await tempProject("zitadel-start-docker-fail-");
    const fake = await fakeDocker({ dockerAvailable: false });
    const port = await freePort();

    const result = await runCliForTest(
      ["start", "--cwd", cwd, "--json", "--runtime", "docker", "--port", String(port)],
      {
        PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
        DOCKER_LOG: fake.logPath,
      },
    );

    expect(result.exitCode).toBe(3);
    const envelope = parseJson(result.stdout) as {
      status: string;
      code: string;
      hint: string;
      next_commands: string[];
      details: { message: string };
    };
    expect(envelope.status).toBe("error");
    expect(envelope.code).toBe("E_VALIDATION");
    expect(envelope.hint).toContain("managed local runtime");
    expect(envelope.hint).toContain("--server <url>");
    expect(envelope.next_commands).toContain("docker version");
    expect(envelope.next_commands).toContain(expectedPublicCliCommand("start"));
    expect(envelope.details.message).toContain("remote or cloud setup can continue");

    const dockerCalls = await readDockerCalls(fake.logPath);
    expect(dockerCalls).toEqual([["version", "--format", "{{.Server.Version}}"]]);
  });

  it("start --json defaults to the npm binary runtime and writes metadata", async () => {
    const cwd = await tempProject("zitadel-start-binary-");
    const fake = await fakeServerBinary();
    const port = await freePort();
    const serverUrl = `http://localhost:${String(port)}`;

    const result = await runCliForTest(["start", "--cwd", cwd, "--json", "--port", String(port)], {
      ZITADEL_SERVER_BINARY: fake.binPath,
    });

    expect(result.exitCode).toBe(0);
    const envelope = parseJson(result.stdout) as {
      status: string;
      data: {
        runtime: { backend: string; pid: number; log_path: string; server_package: string };
        urls: { api: string };
        next_commands: string[];
      };
    };
    expect(envelope.status).toBe("ok");
    expect(envelope.data.urls.api).toBe(serverUrl);
    expect(envelope.data.runtime).toMatchObject({
      backend: "binary",
      log_path: localRuntimePaths(cwd).logFile,
      server_package: "@zitadel/server",
    });
    expect(envelope.data.runtime.pid).toBeGreaterThan(0);
    binaryPids.push(envelope.data.runtime.pid);
    expect(envelope.data.next_commands).toEqual([expectedPublicCliCommand("setup --server local")]);

    const runtime = await readRuntimeMetadata(cwd);
    expect(runtime).toMatchObject({
      backend: "binary",
      port,
      server_url: serverUrl,
      data_dir: localRuntimePaths(cwd).dataDir,
    });
    await expect(readFile(join(cwd, ".gitignore"), "utf8")).resolves.toContain(".zitadel/local/");

    const logs = await runCliForTest(["logs", "--cwd", cwd, "--json", "--tail", "20"]);
    expect(logs.exitCode).toBe(0);
    expect(parseJson(logs.stdout)).toMatchObject({
      status: "ok",
      data: {
        runtime: { backend: "binary" },
        logs: expect.stringContaining("fake zitadel server listening"),
      },
    });
    // Zero-config claim journey: the launcher itself must seed the platform
    // project, without the caller exporting any NEXTGEN_* env.
    expect((parseJson(logs.stdout) as { data: { logs: string } }).data.logs).toContain(
      "platform bootstrap=true",
    );

    const stop = await runCliForTest(["stop", "--cwd", cwd, "--json"]);
    expect(stop.exitCode).toBe(0);
  });

  it("start fails with E_PORT_IN_USE when a foreign listener owns the requested port", async () => {
    const cwd = await tempProject("zitadel-start-port-conflict-");
    const fake = await fakeServerBinary();
    const serverUrl = await startHealthServer();
    const port = Number(new URL(serverUrl).port);

    const result = await runCliForTest(["start", "--cwd", cwd, "--json", "--port", String(port)], {
      ZITADEL_SERVER_BINARY: fake.binPath,
    });

    expect(result.exitCode).toBe(5);
    const envelope = parseJson(result.stdout) as {
      code: string;
      details: { listeners: unknown[]; port: number };
      next_commands?: string[];
      status: string;
    };
    expect(envelope.status).toBe("error");
    expect(envelope.code).toBe("E_PORT_IN_USE");
    expect(envelope.details.port).toBe(port);
    expect(envelope.details.listeners.length).toBeGreaterThan(0);
    expect(envelope.next_commands).toContain(expectedPublicCliCommand("stop --all"));
  });

  it("start fails if its spawned binary exits even when another health server appears", async () => {
    const cwd = await tempProject("zitadel-start-dead-pid-");
    const fake = await fakeExitingServerWithForeignHealth();
    const port = await freePort();

    const result = await runCliForTest(["start", "--cwd", cwd, "--json", "--port", String(port)], {
      ZITADEL_SERVER_BINARY: fake.binPath,
    });

    expect(result.exitCode).toBe(4);
    const envelope = parseJson(result.stdout) as { code: string; message: string; status: string };
    expect(envelope.status).toBe("error");
    expect(envelope.code).toBe("E_NETWORK");
    expect(envelope.message).toContain("process exited before becoming healthy");
  });

  it("start --json starts the single-container runtime and writes metadata", async () => {
    const cwd = await tempProject("zitadel-start-");
    const fake = await fakeDocker();
    const port = await freePort();
    const serverUrl = `http://localhost:${String(port)}`;

    const result = await runCliForTest(
      ["start", "--cwd", cwd, "--json", "--runtime", "docker", "--port", String(port)],
      {
        PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
        DOCKER_LOG: fake.logPath,
      },
    );

    expect(result.exitCode).toBe(0);
    const envelope = parseJson(result.stdout) as {
      status: string;
      data: { urls: { api: string }; next_actions: string[]; next_commands: string[] };
    };
    expect(envelope.status).toBe("ok");
    expect(envelope.data.urls.api).toBe(serverUrl);
    expect(envelope.data.next_actions.join("\n")).toContain("From your app directory");
    expect(envelope.data.next_actions.join("\n")).toContain("Setup installs dependencies");
    expect(envelope.data.next_commands).toEqual([expectedPublicCliCommand("setup --server local")]);
    expect(envelope.data.next_commands).not.toContain("npm install");
    expect(envelope.data.next_commands).not.toContain("npm run dev");

    const runtime = await readRuntimeMetadata(cwd);
    expect(runtime?.server_url).toBe(serverUrl);
    await expect(readFile(join(cwd, ".gitignore"), "utf8")).resolves.toContain(".zitadel/local/");

    const dockerCalls = await readDockerCalls(fake.logPath);
    const runCall = dockerCalls.find((args) => args[0] === "run");
    expect(runCall).toBeDefined();
    expect(runCall?.join(" ")).toContain(`${localRuntimePaths(cwd).dataDir}:${CONTAINER_DATA_DIR}`);
    expect(runCall?.join(" ")).toContain(`NEXTGEN_SERVER_DATA_DIR=${CONTAINER_DATA_DIR}`);
    // Zero-config claim journey: the launcher itself must seed the platform
    // project, without the caller exporting any NEXTGEN_* env.
    expect(runCall?.join(" ")).toContain("NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT=true");
    expect(runCall?.join(" ")).not.toContain("NEXTGEN_SERVER_ENCRYPTION_KEY");
    expect(runCall?.at(-1)).toBe(await expectedDefaultImage());
  });

  it("start uses a prebuilt local image without pulling it", async () => {
    const cwd = await tempProject("zitadel-start-local-image-");
    const fake = await fakeDocker({ imageExists: true });
    const port = await freePort();

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

  it("start uses ZITADEL_LOCAL_IMAGE before the derived alpha image", async () => {
    const cwd = await tempProject("zitadel-start-env-image-");
    const fake = await fakeDocker({ imageExists: true });
    const port = await freePort();

    const result = await runCliForTest(
      ["start", "--cwd", cwd, "--json", "--runtime", "docker", "--port", String(port)],
      {
        PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
        DOCKER_LOG: fake.logPath,
        ZITADEL_LOCAL_IMAGE: "zitadel-nextgen:env",
      },
    );

    expect(result.exitCode).toBe(0);
    const dockerCalls = await readDockerCalls(fake.logPath);
    expect(dockerCalls.find((args) => args[0] === "run")?.at(-1)).toBe("zitadel-nextgen:env");
  });

  it("start --image overrides ZITADEL_LOCAL_IMAGE", async () => {
    const cwd = await tempProject("zitadel-start-replace-image-");
    const fake = await fakeDocker({ imageExists: true });
    const port = await freePort();

    const result = await runCliForTest(
      [
        "start",
        "--cwd",
        cwd,
        "--json",
        "--port",
        String(port),
        "--image",
        "zitadel-nextgen:override",
      ],
      {
        PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
        DOCKER_LOG: fake.logPath,
        ZITADEL_LOCAL_IMAGE: "zitadel-nextgen:env",
      },
    );

    expect(result.exitCode).toBe(0);
    const dockerCalls = await readDockerCalls(fake.logPath);
    expect(dockerCalls.find((args) => args[0] === "run")?.at(-1)).toBe("zitadel-nextgen:override");
  });

  it("start replaces an existing container from another image", async () => {
    const cwd = await tempProject("zitadel-start-replace-image-");
    const fake = await fakeDocker({ existingContainerImage: "ghcr.io/zitadel/nextgen:old" });
    const port = await freePort();

    const result = await runCliForTest(
      ["start", "--cwd", cwd, "--json", "--runtime", "docker", "--port", String(port)],
      {
        PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
        DOCKER_LOG: fake.logPath,
      },
    );

    expect(result.exitCode).toBe(0);
    const dockerCalls = await readDockerCalls(fake.logPath);
    expect(dockerCalls.some((args) => args[0] === "stop")).toBe(true);
    expect(dockerCalls.some((args) => args[0] === "rm")).toBe(true);
    expect(dockerCalls.find((args) => args[0] === "run")?.at(-1)).toBe(
      await expectedDefaultImage(),
    );
  });

  it("start removes Docker runtime metadata before switching to the binary runtime", async () => {
    const cwd = await tempProject("zitadel-start-binary-after-docker-");
    const fakeDockerRuntime = await fakeDocker({
      existingContainerImage: "ghcr.io/zitadel/nextgen:old",
    });
    const fakeBinary = await fakeServerBinary();
    const port = await freePort();
    const serverUrl = `http://localhost:${String(port)}`;
    const containerName = localContainerName(cwd);
    await writeRuntimeMetadata(cwd, runtimeFor(cwd, serverUrl));

    const result = await runCliForTest(
      ["start", "--cwd", cwd, "--json", "--runtime", "binary", "--port", String(port)],
      {
        PATH: `${fakeDockerRuntime.binDir}:${process.env.PATH ?? ""}`,
        DOCKER_LOG: fakeDockerRuntime.logPath,
        ZITADEL_SERVER_BINARY: fakeBinary.binPath,
      },
    );

    expect(result.exitCode).toBe(0);
    const envelope = parseJson(result.stdout) as {
      status: string;
      data: { runtime: { backend: string; pid: number } };
    };
    expect(envelope.status).toBe("ok");
    expect(envelope.data.runtime.backend).toBe("binary");
    binaryPids.push(envelope.data.runtime.pid);

    const dockerCalls = await readDockerCalls(fakeDockerRuntime.logPath);
    expect(dockerCalls.some((args) => args[0] === "inspect" && args.at(-1) === containerName)).toBe(
      true,
    );
    expect(dockerCalls).toContainEqual(["stop", containerName]);
    expect(dockerCalls).toContainEqual(["rm", containerName]);
  });

  it("logs without runtime suggests the published start command", async () => {
    const cwd = await tempProject("zitadel-logs-no-runtime-");
    const fake = await fakeDocker();

    const result = await runCliForTest(["logs", "--cwd", cwd, "--json"], {
      PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: fake.logPath,
    });

    expect(result.exitCode).toBe(3);
    const envelope = parseJson(result.stdout) as {
      status: string;
      next_commands?: string[];
    };
    expect(envelope.status).toBe("error");
    expect(envelope.next_commands).toEqual([expectedPublicCliCommand("start")]);
  });

  it("stop succeeds without suggesting a restart", async () => {
    const cwd = await tempProject("zitadel-stop-");
    const fake = await fakeDocker();

    const result = await runCliForTest(["stop", "--cwd", cwd, "--json"], {
      PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: fake.logPath,
    });

    expect(result.exitCode).toBe(0);
    const envelope = parseJson(result.stdout) as {
      status: string;
      data: { next_commands?: string[] };
    };
    expect(envelope.status).toBe("ok");
    expect(envelope.data.next_commands).toBeUndefined();
  });

  it("stop --dry-run suggests the published stop command", async () => {
    const cwd = await tempProject("zitadel-stop-dry-run-");
    const fake = await fakeDocker();

    const result = await runCliForTest(["stop", "--cwd", cwd, "--json", "--dry-run"], {
      PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: fake.logPath,
    });

    expect(result.exitCode).toBe(0);
    const envelope = parseJson(result.stdout) as {
      status: string;
      data: { next_commands?: string[] };
    };
    expect(envelope.status).toBe("ok");
    expect(envelope.data.next_commands).toEqual([expectedPublicCliCommand("stop")]);
  });

  it("stop --all reports only discovered CLI-managed runtime candidates", async () => {
    const cwd = await tempProject("zitadel-stop-all-");
    const fakePs = await fakeProcessTable([
      {
        pid: 999_981,
        ppid: 1,
        command: "/usr/local/bin/node /tmp/app/node_modules/@zitadel/server/bin/zitadel-server.js",
      },
      { pid: 999_982, ppid: 1, command: "/usr/local/bin/node /tmp/unrelated.js" },
    ]);

    const result = await runCliForTest(["stop", "--cwd", cwd, "--json", "--all"], {
      PATH: `${fakePs.binDir}:${process.env.PATH ?? ""}`,
    });

    expect(result.exitCode).toBe(0);
    const envelope = parseJson(result.stdout) as {
      data: {
        sweep: {
          count: number;
          results: Array<{ process: { pid: number }; stop_result: { status: string } }>;
          scope: string;
        };
      };
      status: string;
    };
    expect(envelope.status).toBe("ok");
    expect(envelope.data.sweep.scope).toBe("host");
    expect(envelope.data.sweep.count).toBe(1);
    expect(envelope.data.sweep.results).toEqual([
      {
        process: expect.objectContaining({ pid: 999_981 }),
        stop_result: expect.objectContaining({ status: "stale" }),
      },
    ]);
  });

  it("reset --force deletes local runtime data without suggesting a restart", async () => {
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
    const envelope = parseJson(result.stdout) as {
      status: string;
      data: { next_commands?: string[] };
    };
    expect(envelope.status).toBe("ok");
    expect(envelope.data.next_commands).toBeUndefined();
    await expect(stat(paths.dataDir)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readRuntimeMetadata(cwd)).resolves.toBeUndefined();
  });

  it("reset without --force suggests the published force command in non-interactive mode", async () => {
    const cwd = await tempProject("zitadel-reset-needs-force-");
    const fake = await fakeDocker();

    const result = await runCliForTest(["reset", "--cwd", cwd, "--json"], {
      PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: fake.logPath,
    });

    expect(result.exitCode).toBe(3);
    const envelope = parseJson(result.stdout) as {
      status: string;
      next_commands?: string[];
    };
    expect(envelope.status).toBe("error");
    expect(envelope.next_commands).toEqual([expectedPublicCliCommand("reset --force")]);
  });
});

async function tempProject(prefix: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(cwd);
  return cwd;
}

async function fakeDocker(
  options: {
    dockerAvailable?: boolean;
    existingContainerImage?: string;
    imageExists?: boolean;
    imageAvailable?: boolean;
  } = {},
): Promise<{ binDir: string; logPath: string }> {
  const binDir = await mkdtemp(join(tmpdir(), "zitadel-fake-docker-"));
  tempDirs.push(binDir);
  const logPath = join(binDir, "docker.log");
  const healthPidLog = join(binDir, "docker-health-pids.log");
  dockerHealthPidLogs.push(healthPidLog);
  const dockerPath = join(binDir, "docker");
  await writeFile(
    dockerPath,
    `#!/usr/bin/env node
const childProcess = require("node:child_process");
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DOCKER_LOG, JSON.stringify(args) + "\\n");
function startHealthServer() {
  const publishIndex = args.indexOf("--publish");
  const publish = publishIndex >= 0 ? args[publishIndex + 1] : "";
  const match = publish.match(/127\\.0\\.0\\.1:(\\d+):/);
  if (!match) return;
  const child = childProcess.spawn(process.execPath, ["-e", \`
    const http = require("node:http");
    const port = Number(process.env.FAKE_DOCKER_HEALTH_PORT);
    const server = http.createServer((req, res) => {
      if (req.url === "/healthz") {
        res.writeHead(200).end("ok");
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(port, "127.0.0.1");
    process.on("SIGTERM", () => server.close(() => process.exit(0)));
    process.on("SIGINT", () => server.close(() => process.exit(0)));
  \`], {
    detached: true,
    env: { ...process.env, FAKE_DOCKER_HEALTH_PORT: match[1] },
    stdio: "ignore",
  });
  child.unref();
  fs.appendFileSync(${JSON.stringify(healthPidLog)}, String(child.pid) + "\\n");
}
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
if (args[0] === "manifest" && args[1] === "inspect") {
  process.exit(${options.imageAvailable === false ? "1" : "0"});
}
if (args[0] === "inspect") {
  if (${options.existingContainerImage ? "true" : "false"}) {
    console.log("container-test-id true ${options.existingContainerImage ?? ""}");
    process.exit(0);
  }
  process.exit(1);
}
if (args[0] === "run") {
  startHealthServer();
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

async function fakeServerBinary(): Promise<{ binPath: string }> {
  const binDir = await mkdtemp(join(tmpdir(), "zitadel-fake-server-"));
  tempDirs.push(binDir);
  const binPath = join(binDir, "zitadel-server");
  await writeFile(
    binPath,
    `#!/usr/bin/env node
const http = require("node:http");
const address = process.env.NEXTGEN_SERVER_ADDRESS || ":8080";
const port = Number(address.split(":").at(-1));
const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200).end("ok");
    return;
  }
  res.writeHead(404).end();
});
server.listen(port, "localhost", () => {
  console.log(
    "fake zitadel server listening " + port +
    " platform bootstrap=" + (process.env.NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT || "unset"),
  );
});
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
`,
  );
  await chmod(binPath, 0o755);
  return { binPath };
}

async function fakeExitingServerWithForeignHealth(): Promise<{ binPath: string }> {
  const binDir = await mkdtemp(join(tmpdir(), "zitadel-fake-server-exit-"));
  tempDirs.push(binDir);
  const healthPidLog = join(binDir, "foreign-health-pids.log");
  dockerHealthPidLogs.push(healthPidLog);
  const binPath = join(binDir, "zitadel-server");
  await writeFile(
    binPath,
    `#!/usr/bin/env node
const childProcess = require("node:child_process");
const fs = require("node:fs");
const address = process.env.NEXTGEN_SERVER_ADDRESS || ":8080";
const port = Number(address.split(":").at(-1));
const child = childProcess.spawn(process.execPath, ["-e", \`
  const http = require("node:http");
  const port = Number(process.env.FOREIGN_HEALTH_PORT);
  const server = http.createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200).end("ok");
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port, "127.0.0.1");
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
\`], {
  detached: true,
  env: { ...process.env, FOREIGN_HEALTH_PORT: String(port) },
  stdio: "ignore",
});
child.unref();
fs.appendFileSync(${JSON.stringify(healthPidLog)}, String(child.pid) + "\\n");
process.exit(0);
`,
  );
  await chmod(binPath, 0o755);
  return { binPath };
}

async function fakeProcessTable(
  rows: Array<{ command: string; pid: number; ppid: number }>,
): Promise<{ binDir: string }> {
  const binDir = await mkdtemp(join(tmpdir(), "zitadel-fake-ps-"));
  tempDirs.push(binDir);
  const psPath = join(binDir, "ps");
  await writeFile(
    psPath,
    `#!/usr/bin/env node
const rows = ${JSON.stringify(rows)};
const args = process.argv.slice(2);
if (args[0] === "axo") {
  for (const row of rows) {
    console.log(String(row.pid).padStart(6) + " " + String(row.ppid).padStart(6) + " " + row.command);
  }
  process.exit(0);
}
if (args[0] === "eww") {
  const pid = Number(args[2]);
  const row = rows.find((candidate) => candidate.pid === pid);
  if (row) console.log(row.command);
  process.exit(0);
}
process.exit(1);
`,
  );
  await chmod(psPath, 0o755);
  return { binDir };
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
    backend: "docker",
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

function runtimePidOf(stdout: string): number {
  return (parseJson(stdout) as { data: { runtime: { pid: number } } }).data.runtime.pid;
}

async function expectedDefaultImage(): Promise<string> {
  const pkg = JSON.parse(
    await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  return defaultLocalServerImageForCliVersion(pkg.version);
}
