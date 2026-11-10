import { readFile } from "node:fs/promises";
import { execa } from "execa";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DockerLauncher } from "@/lib/local-server/internal/docker-launcher";
import { CONTAINER_DATA_DIR } from "@/lib/local-server/runtime";
import type { LogSink } from "@/lib/local-server/server-log";

vi.mock("execa", () => ({ execa: vi.fn() }));

/** What a finished `docker` resolves to. */
function dockerResult(stdout: string, exitCode = 0, stderr = "") {
  return { stdout, stderr, exitCode, failed: exitCode !== 0 };
}

describe("DockerLauncher", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The server derives its default data dir next to the entrypoint, which lives
  // in root-owned /usr/local/bin. Without this ENV the image cannot start as the
  // non-root USER it declares, and `zitadel start --runtime docker` dies before
  // serving. CI has no Docker, so this parity check is the gate.
  it("ships an image whose data dir default matches the mount the CLI provides", async () => {
    const dockerfile = await readFile(
      new URL("../../../../../../../Dockerfile", import.meta.url),
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
    const args = DockerLauncher.runArgs({
      cliVersion: "0.0.0-test",
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
    // No local admin to import, so the container boots a bare instance.
    expect(args.join(" ")).not.toContain("NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT");
    expect(args).not.toContain("--user-file");
  });

  it("mounts the local admin document and boots the platform project with it", () => {
    const args = DockerLauncher.runArgs({
      cliVersion: "0.0.0-test",
      containerName: "zitadel-server-test",
      image: "ghcr.io/zitadel/nextgen:test",
      port: 8090,
      dataDir: "/tmp/app/.zitadel/local/nextgen-data",
      userFile: "/tmp/app/.zitadel/local/admin-user.json",
    });

    expect(args).toContain("NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT=true");
    const mount = args[args.indexOf("--volume", args.indexOf("--env")) + 1];
    expect(mount).toBe(
      "/tmp/app/.zitadel/local/admin-user.json:/var/lib/zitadel/bootstrap/admin-user.json:ro",
    );
    // The image's own CMD is replaced, so the migrate default is passed again.
    expect(args.slice(-3)).toEqual([
      "--migrate",
      "--user-file",
      "/var/lib/zitadel/bootstrap/admin-user.json",
    ]);
    // The image still precedes the server arguments.
    expect(args[args.length - 4]).toBe("ghcr.io/zitadel/nextgen:test");
  });

  it("declares project variables as bare --env NAME so values stay out of argv", () => {
    const args = DockerLauncher.runArgs(
      {
        cliVersion: "0.0.0-test",
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
    const calls = fakeDocker({});

    const metadata = await new DockerLauncher({
      cliVersion: "0.0.0-test",
      containerName: "zitadel-server-test",
      image: "ghcr.io/zitadel/nextgen:test",
      dataDir: "/tmp/app/.zitadel/local/nextgen-data",
      env: {
        values: { GOOGLE_CLIENT_SECRET: "canary-secret" },
        injected: ["GOOGLE_CLIENT_SECRET"],
      },
    }).launch({ port: 8090, serverUrl: "http://localhost:8090" });

    const run = calls.find((call) => call.args[0] === "run");
    expect(run?.command).toBe("docker");
    expect(run?.args).toContain("GOOGLE_CLIENT_SECRET");
    expect(run?.args.join(" ")).not.toContain("canary-secret");
    expect(run?.env.GOOGLE_CLIENT_SECRET).toBe("canary-secret");
    expect(metadata.container_id).toBe("cid-1");
    expect(metadata.env).toEqual({ injected: ["GOOGLE_CLIENT_SECRET"] });
    expect(JSON.stringify(metadata)).not.toContain("canary-secret");
  });

  describe("lifecycle", () => {
    const launcher = () =>
      new DockerLauncher({
        cliVersion: "0.0.0-test",
        containerName: "zitadel-server-test",
        image: "ghcr.io/zitadel/nextgen:test",
        dataDir: "/tmp/app/.zitadel/local/nextgen-data",
      });
    const record = DockerLauncher.metadata({
      cwdDataDir: "/tmp/app/.zitadel/local/nextgen-data",
      cliVersion: "0.0.0-test",
      containerName: "zitadel-server-test",
      containerId: "cid-1",
      image: "ghcr.io/zitadel/nextgen:test",
      port: 8090,
      serverUrl: "http://localhost:8090",
    });

    it("records the container it started on the port it was given", async () => {
      fakeDocker({});

      await expect(
        launcher().launch({ port: 8090, serverUrl: "http://localhost:8090" }),
      ).resolves.toMatchObject({
        backend: "docker",
        container_name: "zitadel-server-test",
        container_id: "cid-1",
        port: 8090,
        server_url: "http://localhost:8090",
      });
    });

    it("publishes the container on the port it was given", async () => {
      const calls = fakeDocker({});

      await launcher().launch({ port: 8085, serverUrl: "http://localhost:8085" });

      const run = calls.find((call) => call.args[0] === "run");
      expect(run?.args).toContain("127.0.0.1:8085:8080");
    });

    it("removes a leftover container of the same name before it starts", async () => {
      const calls = fakeDocker({ existing: { running: true } });

      await launcher().launch({ port: 8090, serverUrl: "http://localhost:8090" });

      const verbs = calls.map((call) => call.args[0]);
      expect(verbs.indexOf("rm")).toBeGreaterThan(-1);
      expect(verbs.indexOf("rm")).toBeLessThan(verbs.indexOf("run"));
    });

    it("is alive while its container runs", async () => {
      fakeDocker({ existing: { running: true } });

      await expect(launcher().isAlive(record)).resolves.toBe(true);
    });

    it("is not alive once its container has stopped", async () => {
      fakeDocker({ existing: { running: false } });

      await expect(launcher().isAlive(record)).resolves.toBe(false);
    });

    it("stops and removes a container that exists", async () => {
      const calls = fakeDocker({ existing: { running: true } });

      await expect(launcher().terminate(record)).resolves.toMatchObject({ status: "stopped" });
      expect(calls.map((call) => call.args[0])).toEqual(expect.arrayContaining(["stop", "rm"]));
    });

    it("removes the container a failed run may have created, and reports the failure", async () => {
      const calls = fakeDocker({ runFails: true });

      await expect(
        launcher().launch({ port: 8090, serverUrl: "http://localhost:8090" }),
      ).rejects.toMatchObject({ code: "E_VALIDATION" });

      const verbs = calls.map((call) => call.args[0]);
      expect(verbs.lastIndexOf("inspect")).toBeGreaterThan(verbs.indexOf("run"));
    });

    it("says whether it removed a container", async () => {
      fakeDocker({ existing: { running: true } });
      await expect(DockerLauncher.remove("zitadel-server-test")).resolves.toBe(true);

      fakeDocker({});
      await expect(DockerLauncher.remove("zitadel-server-test")).resolves.toBe(false);
    });

    it("removes nothing, and does not fail, where Docker is not installed", async () => {
      dockerIsNotInstalled();

      await expect(DockerLauncher.remove("zitadel-server-test")).resolves.toBe(false);
    });

    it("reads the end of the container's log", async () => {
      const calls = fakeDocker({ existing: { running: true } });

      await expect(launcher().logTail(record, 40)).resolves.toBe("level=INFO msg=listening\n");
      expect(calls.find((call) => call.args[0] === "logs")?.args).toEqual([
        "logs",
        "--tail",
        "40",
        "zitadel-server-test",
      ]);
    });

    it("reports a container that is already gone as stale", async () => {
      const calls = fakeDocker({});

      await expect(launcher().terminate(record)).resolves.toMatchObject({ status: "stale" });
      expect(calls.map((call) => call.args[0])).not.toContain("rm");
    });
  });

  describe("reading the container's log", () => {
    /**
     * Answers each `docker` the code runs with the next of `answers`, and records its arguments.
     * A followed log is answered as the whole-line stream of each of its two outputs.
     */
    function dockerAnswering(...answers: Array<{ stdout?: string; stderr?: string }>): string[][] {
      const calls: string[][] = [];
      vi.mocked(execa).mockImplementation(((_command: string, args: string[]) => {
        calls.push(args);
        const answer = answers.shift() ?? {};
        const result = dockerResult(answer.stdout ?? "", 0, answer.stderr ?? "");
        const linesOf = (text: string) => text.split(/(?<=\n)/).filter((line) => line !== "");
        return Object.assign(Promise.resolve(result), {
          iterable: ({ from }: { from: "stdout" | "stderr" }) =>
            (async function* () {
              yield* linesOf(from === "stdout" ? result.stdout : result.stderr);
            })(),
        });
      }) as never);
      return calls;
    }

    function aSink(): LogSink & { existingText: string[]; appendedText: string[] } {
      const existingText: string[] = [];
      const appendedText: string[] = [];
      return {
        existingText,
        appendedText,
        existing: (text) => existingText.push(text),
        appended: (text) => appendedText.push(text),
      };
    }

    it("reads the whole log when asked for all of it", async () => {
      const calls = dockerAnswering({ stderr: "level=INFO msg=a\n" });

      await expect(DockerLauncher.readLogs("zitadel-server-test", "all")).resolves.toBe(
        "level=INFO msg=a\n",
      );
      expect(calls).toEqual([["logs", "--tail", "all", "zitadel-server-test"]]);
    });

    it("follows the last lines Docker picks, handing them over with what comes after", async () => {
      const calls = dockerAnswering({ stderr: "level=INFO msg=a\nlevel=WARN msg=b\n" });
      const sink = aSink();

      await DockerLauncher.followLogs("zitadel-server-test", 50, sink);

      expect(calls).toEqual([["logs", "--tail", "50", "--follow", "zitadel-server-test"]]);
      expect(sink.existingText).toEqual([]);
      expect(sink.appendedText.join("")).toBe("level=INFO msg=a\nlevel=WARN msg=b\n");
    });

    it("hands over the whole log first, then only what the follow adds to it", async () => {
      dockerAnswering(
        { stderr: "level=INFO msg=a\nlevel=WARN msg=still bei" },
        { stderr: "level=INFO msg=a\nlevel=WARN msg=still being written\nlevel=ERROR msg=new\n" },
      );
      const sink = aSink();

      await DockerLauncher.followLogs("zitadel-server-test", "all", sink);

      expect(sink.existingText).toEqual(["level=INFO msg=a\n"]);
      expect(sink.appendedText.join("")).toBe(
        "level=WARN msg=still being written\nlevel=ERROR msg=new\n",
      );
    });
  });
});

/** Fails each `docker` the code runs the way execa does when there is none on `PATH`. */
function dockerIsNotInstalled(): void {
  vi.mocked(execa).mockResolvedValue({
    stdout: "",
    stderr: "",
    failed: true,
    code: "ENOENT",
    exitCode: undefined,
  } as never);
}

type DockerCall = { command: string; args: string[]; env: NodeJS.ProcessEnv };

/** Answers each `docker` the code runs from a script, and records what it was asked. */
function fakeDocker(options: {
  existing?: { running: boolean };
  runFails?: boolean;
}): DockerCall[] {
  const calls: DockerCall[] = [];
  vi.mocked(execa).mockImplementation(((
    command: string,
    args: string[],
    execaOptions: { env: NodeJS.ProcessEnv },
  ) => {
    calls.push({ command, args, env: execaOptions.env });
    const verb = args[0];
    if (verb === "inspect" && args[1] !== undefined && args[1] !== "--format") {
      return Promise.resolve(dockerResult("", 1));
    }
    if (verb === "inspect") {
      return Promise.resolve(
        options.existing
          ? dockerResult(`cid-1 ${String(options.existing.running)} ghcr.io/zitadel/nextgen:test\n`)
          : dockerResult("", 1),
      );
    }
    if (verb === "image") {
      return Promise.resolve(dockerResult(""));
    }
    if (verb === "run") {
      return Promise.resolve(
        options.runFails
          ? dockerResult("", 125, "port is already allocated")
          : dockerResult("cid-1\n"),
      );
    }
    if (verb === "logs") {
      return Promise.resolve(dockerResult("", 0, "level=INFO msg=listening\n"));
    }
    return Promise.resolve(dockerResult(""));
  }) as never);
  return calls;
}
