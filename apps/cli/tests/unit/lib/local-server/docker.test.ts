import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONTAINER_DATA_DIR } from "../../../../src/lib/local-server/runtime";
import {
  dockerRunArgs,
  metadataFromStart,
  startContainer,
} from "../../../../src/lib/local-server/docker";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn() };
});

function fakeDockerProcess(stdout: string) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { setEncoding: () => void };
    stderr: EventEmitter & { setEncoding: () => void };
  };
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: () => undefined });
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: () => undefined });
  queueMicrotask(() => {
    child.stdout.emit("data", stdout);
    child.emit("close", 0);
  });
  return child;
}

describe("local server Docker helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The server derives its default data dir next to the entrypoint, which lives
  // in root-owned /usr/local/bin. Without this ENV the image cannot start as the
  // non-root USER it declares, and `zitadel start --runtime docker` dies before
  // serving. CI has no Docker, so this parity check is the gate.
  it("ships an image whose data dir default matches the mount the CLI provides", async () => {
    const dockerfile = await readFile(
      new URL("../../../../../../Dockerfile", import.meta.url),
      "utf8",
    );

    expect(dockerfile).toContain(`ENV NEXTGEN_SERVER_DATA_DIR=${CONTAINER_DATA_DIR}`);
    // The declared USER is what makes the default location unwritable.
    expect(dockerfile).toContain("USER 65532:65532");
    // Bare `docker run` must still migrate; the image CMD is how smoke-container
    // and `zitadel start --runtime docker` keep applying schema after --migrate
    // defaulted off on the binary.
    expect(dockerfile).toContain('CMD ["--migrate"]');
  });

  it("builds the single-container run command without an explicit encryption key", () => {
    const args = dockerRunArgs({
      containerName: "zitadel-server-test",
      image: "ghcr.io/zitadel/nextgen:test",
      port: 8090,
      dataDir: "/tmp/app/.zitadel/local/nextgen-data",
      identity: {
        uid: 501,
        gid: 20,
        passwdFile: "/tmp/app/.zitadel/local/container-passwd",
        groupFile: "/tmp/app/.zitadel/local/container-group",
      },
    });

    expect(args).toEqual([
      "run",
      "--detach",
      "--name",
      "zitadel-server-test",
      "--publish",
      "127.0.0.1:8090:8080",
      "--volume",
      `/tmp/app/.zitadel/local/nextgen-data:${CONTAINER_DATA_DIR}`,
      "--env",
      "NEXTGEN_SERVER_ADDRESS=:8080",
      "--env",
      `NEXTGEN_SERVER_DATA_DIR=${CONTAINER_DATA_DIR}`,
      "--env",
      "NEXTGEN_SERVER_PUBLIC_BASE=http://localhost:8090",
      "--volume",
      "/tmp/app/.zitadel/local/container-passwd:/etc/passwd:ro",
      "--volume",
      "/tmp/app/.zitadel/local/container-group:/etc/group:ro",
      "--user",
      "501:20",
      "ghcr.io/zitadel/nextgen:test",
    ]);
    expect(args.join(" ")).not.toContain("NEXTGEN_SERVER_ENCRYPTION_KEY");
  });

  it("declares project variables as bare --env NAME so values stay out of argv", () => {
    const args = dockerRunArgs(
      {
        containerName: "zitadel-server-test",
        image: "ghcr.io/zitadel/nextgen:test",
        port: 8090,
        dataDir: "/tmp/app/.zitadel/local/nextgen-data",
      },
      ["GOOGLE_CLIENT_SECRET", "GITHUB_CLIENT_SECRET"],
    );

    // Project names come first: Docker keeps the last value for a repeated
    // name, so the CLI's own settings cannot be overridden from .env.local.
    const envFlags = args.flatMap((arg, i) => (arg === "--env" ? [args[i + 1]] : []));
    expect(envFlags).toEqual([
      "GOOGLE_CLIENT_SECRET",
      "GITHUB_CLIENT_SECRET",
      "NEXTGEN_SERVER_ADDRESS=:8080",
      `NEXTGEN_SERVER_DATA_DIR=${CONTAINER_DATA_DIR}`,
      "NEXTGEN_SERVER_PUBLIC_BASE=http://localhost:8090",
    ]);
  });

  it("hands resolved values to the docker client through its environment only", async () => {
    vi.mocked(spawn).mockImplementation(
      () => fakeDockerProcess("abc123\n") as unknown as ReturnType<typeof spawn>,
    );

    const { containerId, env } = await startContainer({
      containerName: "zitadel-server-test",
      image: "ghcr.io/zitadel/nextgen:test",
      port: 8090,
      dataDir: "/tmp/app/.zitadel/local/nextgen-data",
      env: {
        values: { GOOGLE_CLIENT_SECRET: "canary-secret" },
        injected: ["GOOGLE_CLIENT_SECRET"],
        missing: [],
      },
    });

    const [command, args, options] = vi.mocked(spawn).mock.calls[0] as unknown as [
      string,
      string[],
      { env: NodeJS.ProcessEnv },
    ];
    expect(command).toBe("docker");
    expect(args).toContain("GOOGLE_CLIENT_SECRET");
    expect(args.join(" ")).not.toContain("canary-secret");
    expect(options.env.GOOGLE_CLIENT_SECRET).toBe("canary-secret");
    expect(containerId).toBe("abc123");
    expect(env.injected).toEqual(["GOOGLE_CLIENT_SECRET"]);

    const metadata = metadataFromStart({
      cwdDataDir: "/tmp/app/.zitadel/local/nextgen-data",
      cliVersion: "0.0.0-test",
      containerName: "zitadel-server-test",
      containerId,
      image: "ghcr.io/zitadel/nextgen:test",
      port: 8090,
      serverUrl: "http://localhost:8090",
      env,
    });
    expect(metadata.env).toEqual({ injected: ["GOOGLE_CLIENT_SECRET"], missing: [] });
    expect(JSON.stringify(metadata)).not.toContain("canary-secret");
  });
});
