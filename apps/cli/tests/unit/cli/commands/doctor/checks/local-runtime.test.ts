import { describe, expect, it } from "vitest";

import { LocalRuntimeChecks } from "@/cli/commands/doctor/checks/local-runtime";
import {
  type DockerResult,
  LocalRuntime,
  type LocalServers,
  type RuntimeBackend,
  type RuntimeMetadata,
  type TcpListener,
} from "@/lib/server";
import { aSuggest } from "@tests/helpers/suggestions";

/** What a machine answers to the probes; what a test leaves out is a healthy machine. */
type Machine = {
  docker?: DockerResult | Error;
  image?: "local" | "remote" | Error;
  healthy?: boolean;
  listeners?: readonly TcpListener[];
};

/** The checks over a machine that answers as the test scripts it. */
class ScriptedChecks extends LocalRuntimeChecks {
  private readonly machine: Machine;

  constructor(machine: Machine, ...checks: ConstructorParameters<typeof LocalRuntimeChecks>) {
    super(...checks);
    this.machine = machine;
  }

  protected override binaryVersion(): string {
    return "1.2.3";
  }

  protected override async canWrite(dir: string) {
    return { targetPath: dir, checkedPath: dir };
  }

  protected override async docker(): Promise<DockerResult> {
    const { docker = { status: 0, stdout: "27.0\n", stderr: "" } } = this.machine;
    if (docker instanceof Error) {
      throw docker;
    }
    return docker;
  }

  protected override async imageSource(): Promise<"local" | "remote"> {
    const { image = "local" } = this.machine;
    if (image instanceof Error) {
      throw image;
    }
    return image;
  }

  protected override async isHealthy(): Promise<boolean> {
    return this.machine.healthy ?? true;
  }

  protected override async listeners(): Promise<readonly TcpListener[]> {
    return this.machine.listeners ?? [];
  }
}

const PORT = 8080;
const IMAGE = "ghcr.io/zitadel/test:1";
const HOST = "/project";
const NO_OTHERS: LocalServers = {
  current: async () => ({ supported: true, processes: [] }),
};

function aBinaryRuntime(port = PORT): RuntimeMetadata {
  return {
    schema_version: 1,
    backend: "binary",
    port,
    server_url: `http://localhost:${String(port)}`,
    data_dir: "/project/.zitadel/local/data",
    created_at: "2026-01-01T00:00:00.000Z",
    cli_version: "0.0.0",
    pid: 100,
    command: "zitadel-server",
    log_path: "/project/.zitadel/local/server.log",
    server_package: "@zitadel/server",
    server_version: "1.2.3",
  };
}

/** Runs the checks and returns their outcomes by name. */
async function outcomes(
  options: {
    machine?: Machine;
    runtime?: RuntimeMetadata;
    backend?: RuntimeBackend;
    servers?: LocalServers;
    inheritedFrom?: string;
  } = {},
) {
  const checks = new ScriptedChecks(
    options.machine ?? {},
    HOST,
    options.runtime,
    options.backend ?? "binary",
    IMAGE,
    PORT,
    options.servers ?? NO_OTHERS,
    aSuggest(),
    options.inheritedFrom,
  );
  const all = await checks.run();
  return { all, byName: new Map(all.map((outcome) => [outcome.name, outcome])) };
}

describe("LocalRuntimeChecks", () => {
  it("runs the binary checks in order", async () => {
    const { all } = await outcomes();

    expect(all.map((outcome) => outcome.name)).toEqual([
      "server-binary",
      "state-dir",
      "port",
      "runtime",
      "managed-runtime-processes",
    ]);
  });

  it("runs the Docker checks in order", async () => {
    const { all } = await outcomes({ backend: "docker" });

    expect(all.map((outcome) => outcome.name)).toEqual([
      "docker-cli",
      "image",
      "state-dir",
      "port",
      "runtime",
      "managed-runtime-processes",
    ]);
  });

  it("skips the image check, with a warning, when Docker does not answer", async () => {
    const { byName } = await outcomes({
      backend: "docker",
      machine: { docker: { status: 1, stdout: "", stderr: "daemon down" } },
    });

    expect(byName.get("image")).toEqual({
      name: "image",
      status: "warn",
      message: "Skipped image check because Docker is not reachable.",
    });
  });

  describe("the Docker message", () => {
    it.each([
      ["a trimmed detail", { status: 1, stdout: "", stderr: "daemon down\n" }, " (daemon down)"],
      ["no parentheses without a detail", new Error("  "), ""],
    ])("carries %s", async (_name, docker, detail) => {
      const { byName } = await outcomes({ backend: "docker", machine: { docker } });

      expect(byName.get("docker-cli")).toMatchObject({
        status: "warn",
        message: `Docker is not reachable${detail}; managed local runtime commands need Docker, but remote or cloud setup can continue with --server <url>.`,
      });
    });
  });

  describe("the port", () => {
    it("fails, naming what holds it, with the facts for the report", async () => {
      const listeners = [
        { address: "127.0.0.1", host: "127.0.0.1", port: PORT, pid: 7, command: "node" },
      ];

      const { byName } = await outcomes({ machine: { listeners } });

      expect(byName.get("port")).toEqual({
        name: "port",
        status: "fail",
        message: `Port ${String(PORT)} is already in use by node pid 7`,
        details: { port: PORT, server_url: LocalRuntime.urlOf(PORT), listeners },
      });
    });

    it("passes when the server recorded for it already answers", async () => {
      const listeners = [
        { address: "127.0.0.1", host: "127.0.0.1", port: PORT, pid: 100, command: "zitadel" },
      ];

      const { byName } = await outcomes({ runtime: aBinaryRuntime(), machine: { listeners } });

      expect(byName.get("port")).toMatchObject({
        status: "pass",
        message: `http://localhost:${String(PORT)} is already healthy`,
      });
    });
  });

  describe("the runtime", () => {
    it("passes when there is none", async () => {
      const { byName } = await outcomes();

      expect(byName.get("runtime")).toMatchObject({
        status: "pass",
        message: "No existing runtime metadata",
      });
    });

    it("fails for a runtime of another backend", async () => {
      const { byName } = await outcomes({ runtime: aBinaryRuntime(), backend: "docker" });

      expect(byName.get("runtime")).toMatchObject({
        status: "fail",
        message:
          "Existing local runtime uses binary; run start --runtime docker to switch backends.",
      });
    });

    it("fails when the server does not answer", async () => {
      const { byName } = await outcomes({
        runtime: aBinaryRuntime(9000),
        machine: { healthy: false },
      });

      expect(byName.get("runtime")).toMatchObject({
        status: "fail",
        message: "http://localhost:9000 is not ready: /readyz did not answer ok",
      });
    });

    it.each([
      [undefined, "http://localhost:8080 is healthy"],
      ["/parent", "http://localhost:8080 is healthy (server started in the parent folder /parent)"],
    ])("words a healthy server started in %s", async (inheritedFrom, message) => {
      const { byName } = await outcomes({ runtime: aBinaryRuntime(), inheritedFrom });

      expect(byName.get("runtime")).toMatchObject({ status: "pass", message });
    });
  });

  describe("the other servers on the machine", () => {
    const aServer = (pid: number) => ({
      command: "zitadel-server",
      kind: "server-binary" as const,
      pid,
    });

    it.each([
      [0, "pass", "No other local Zitadel server is running on this machine."],
      [1, "warn", "1 other local Zitadel server is running on this machine."],
      [2, "warn", "2 other local Zitadel servers are running on this machine."],
    ])("reports %i of them", async (count, status, message) => {
      const processes = Array.from({ length: count }, (_, index) => aServer(200 + index));

      const { byName } = await outcomes({
        servers: { current: async () => ({ supported: true, processes }) },
      });

      expect(byName.get("managed-runtime-processes")).toEqual({
        name: "managed-runtime-processes",
        status,
        message,
        details: { supported: true, scope: "host", processes },
      });
    });

    it("leaves out the server the record names", async () => {
      const { byName } = await outcomes({
        runtime: aBinaryRuntime(),
        servers: {
          current: async () => ({ supported: true, processes: [aServer(100), aServer(300)] }),
        },
      });

      expect(byName.get("managed-runtime-processes")).toMatchObject({
        message: "1 other local Zitadel server is running on this machine.",
      });
    });

    it("warns when the machine cannot be read", async () => {
      const { byName } = await outcomes({
        servers: { current: async () => ({ supported: false, error: "no ps", processes: [] }) },
      });

      expect(byName.get("managed-runtime-processes")).toEqual({
        name: "managed-runtime-processes",
        status: "warn",
        message: "Could not look for other local Zitadel servers on this machine.",
        details: { supported: false, error: "no ps" },
      });
    });
  });
});
