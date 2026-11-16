import { execa } from "execa";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("execa", () => ({ execa: vi.fn() }));

const mockExeca = vi.mocked(execa);

import { discoverManagedRuntimeProcesses } from "@/lib/server/local/processes";

/** Answers each `ps` the code runs from `impl`, which gets its arguments and returns its stdout. */
function whenPs(impl: (args: readonly string[]) => string): void {
  mockExeca.mockImplementation(((file: string, args: readonly string[]) => {
    expect(file).toBe("ps");
    return Promise.resolve({ stdout: impl(args), stderr: "", exitCode: 0 });
  }) as never);
}

beforeEach(() => {
  mockExeca.mockReset();
});

describe("discoverManagedRuntimeProcesses", () => {
  it("returns only CLI-managed local runtime processes", async () => {
    whenPs((args) => {
      if (args[0] === "axww") {
        return [
          " 123 1 /usr/local/bin/node /tmp/app/node_modules/@zitadel/server/bin/zitadel-server.js",
          " 234 123 /tmp/app/node_modules/@zitadel/server-darwin-arm64/bin/nextgen",
          " 345 1 /usr/local/bin/nextgen",
          " 456 1 /usr/bin/node /tmp/other.js",
          "",
        ].join("\n");
      }
      const pid = String(args[2]);
      return pid === "234"
        ? "NEXTGEN_SERVER_DATA_DIR=/tmp/app/.zitadel/local/nextgen-data /tmp/app/node_modules/@zitadel/server-darwin-arm64/bin/nextgen"
        : pid === "345"
          ? "NEXTGEN_SERVER_DATA_DIR=/tmp/app/.zitadel/local/nextgen-data /usr/local/bin/nextgen"
          : "";
    });

    const discovery = await discoverManagedRuntimeProcesses();

    expect(discovery).toMatchObject({
      supported: true,
      processes: [
        { kind: "server-wrapper", pid: 123, ppid: 1 },
        { kind: "server-binary", pid: 234, ppid: 123 },
        { kind: "server-binary", pid: 345, ppid: 1 },
      ],
    });
    expect(discovery.processes.find((processInfo) => processInfo.pid === 234)?.command).toBe(
      "/tmp/app/node_modules/@zitadel/server-darwin-arm64/bin/nextgen",
    );
    expect(discovery.processes.find((processInfo) => processInfo.pid === 345)?.command).toBe(
      "/usr/local/bin/nextgen",
    );
  });

  it("strips environment markers without joining adjacent command tokens", async () => {
    whenPs((args) =>
      args[0] === "axww"
        ? " 567 1 /usr/local/bin/nextgen\n"
        : "NEXTGEN_SERVER_DATA_DIR=/tmp/app/.zitadel/local/nextgen-data /usr/local/bin/nextgen FOO=1 --serve",
    );

    const discovery = await discoverManagedRuntimeProcesses();

    expect(discovery.processes).toHaveLength(1);
    expect(discovery.processes[0]).toMatchObject({
      pid: 567,
      command: "/usr/local/bin/nextgen --serve",
    });
  });

  it("reports a process's command without the environment it ran with", async () => {
    whenPs((args) => {
      if (args[0] === "axww") {
        return " 678 1 /usr/local/bin/nextgen --serve\n";
      }
      return args[0] === "eww"
        ? "NEXTGEN_SERVER_DATA_DIR=/tmp/app/.zitadel/local/nextgen-data /usr/local/bin/nextgen --serve npm_config__authToken=s3cret"
        : "/usr/local/bin/nextgen --serve";
    });

    const discovery = await discoverManagedRuntimeProcesses();

    expect(discovery.processes.map((processInfo) => processInfo.command)).toEqual([
      "/usr/local/bin/nextgen --serve",
    ]);
  });

  it("lists every process with its whole command, however wide the terminal", async () => {
    whenPs(() => "");

    await discoverManagedRuntimeProcesses();

    expect(mockExeca.mock.calls[0]?.[1]).toEqual(["axww", "-o", "pid=,ppid=,command="]);
  });

  it.each([
    [
      "a pager following its file",
      "tail -f /tmp/app/node_modules/@zitadel/server/bin/zitadel-server.js",
    ],
    [
      "an editor holding it open",
      "vim /tmp/app/node_modules/@zitadel/server/bin/zitadel-server.js",
    ],
    [
      "a tool node runs on it",
      "/usr/local/bin/node /tmp/app/node_modules/.bin/prettier zitadel-server.js",
    ],
  ])("leaves out %s, which only names the wrapper script", async (_, command) => {
    whenPs((args) => {
      return args[0] === "axww" ? ` 789 1 ${command}\n` : "";
    });

    const discovery = await discoverManagedRuntimeProcesses();

    expect(discovery.processes).toEqual([]);
  });

  it.each([
    [
      "with runtime flags",
      "/usr/local/bin/node --enable-source-maps /tmp/app/node_modules/@zitadel/server/bin/zitadel-server.js start",
    ],
    ["under bun", "/opt/bun/bin/bun /tmp/app/node_modules/@zitadel/server/bin/zitadel-server.js"],
  ])("finds the wrapper run %s", async (_, command) => {
    whenPs((args) => {
      return args[0] === "axww" ? ` 890 1 ${command}\n` : "";
    });

    const discovery = await discoverManagedRuntimeProcesses();

    expect(discovery.processes).toMatchObject([{ kind: "server-wrapper", pid: 890 }]);
  });

  it("reports unsupported discovery instead of throwing", async () => {
    const enoent: NodeJS.ErrnoException = Object.assign(new Error("spawn ps ENOENT"), {
      code: "ENOENT",
    });
    mockExeca.mockRejectedValue(enoent);

    await expect(discoverManagedRuntimeProcesses()).resolves.toMatchObject({
      supported: false,
      processes: [],
    });
  });
});
