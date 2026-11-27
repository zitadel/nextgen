import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import type { Run } from "@/lib/server/local";
import { discoverManagedRuntimeProcesses } from "@/lib/server/local/processes";
import { it } from "@tests/fixtures";

/**
 * A machine whose `ps` answers from `impl`.
 *
 * @param impl - Gets the arguments of each `ps` and returns its stdout.
 * @returns How programs are run there, and the argument lists it was asked with.
 */
function whenPs(impl: (args: readonly string[]) => string): { run: Run; asked: string[][] } {
  const asked: string[][] = [];
  const run: Run = async (program, args) => {
    expect(program).toBe("ps");
    asked.push([...args]);

    return { stdout: impl(args) };
  };

  return { run, asked };
}

/**
 * An empty file at `path`, in a folder made for it.
 *
 * @param path - Where the file goes.
 * @returns The path.
 */
async function aFileAt(path: string): Promise<string> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "");
  return path;
}

describe("discoverManagedRuntimeProcesses", () => {
  it("returns only CLI-managed local runtime processes", async () => {
    const { run } = whenPs((args) => {
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

    const discovery = await discoverManagedRuntimeProcesses({ run });

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
    const { run } = whenPs((args) =>
      args[0] === "axww"
        ? " 567 1 /usr/local/bin/nextgen\n"
        : "NEXTGEN_SERVER_DATA_DIR=/tmp/app/.zitadel/local/nextgen-data /usr/local/bin/nextgen FOO=1 --serve",
    );

    const discovery = await discoverManagedRuntimeProcesses({ run });

    expect(discovery.processes).toHaveLength(1);
    expect(discovery.processes[0]).toMatchObject({
      pid: 567,
      command: "/usr/local/bin/nextgen --serve",
    });
  });

  it("reports a process's command without the environment it ran with", async () => {
    const { run } = whenPs((args) => {
      if (args[0] === "axww") {
        return " 678 1 /usr/local/bin/nextgen --serve\n";
      }
      return args[0] === "eww"
        ? "NEXTGEN_SERVER_DATA_DIR=/tmp/app/.zitadel/local/nextgen-data /usr/local/bin/nextgen --serve npm_config__authToken=s3cret"
        : "/usr/local/bin/nextgen --serve";
    });

    const discovery = await discoverManagedRuntimeProcesses({ run });

    expect(discovery.processes.map((processInfo) => processInfo.command)).toEqual([
      "/usr/local/bin/nextgen --serve",
    ]);
  });

  it("lists every process with its whole command, however wide the terminal", async () => {
    const { run, asked } = whenPs(() => "");

    await discoverManagedRuntimeProcesses({ run });

    expect(asked[0]).toEqual(["axww", "-o", "pid=,ppid=,command="]);
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
    const { run } = whenPs((args) => {
      return args[0] === "axww" ? ` 789 1 ${command}\n` : "";
    });

    const discovery = await discoverManagedRuntimeProcesses({ run });

    expect(discovery.processes).toEqual([]);
  });

  it.each([
    [
      "with runtime flags",
      "/usr/local/bin/node --enable-source-maps /tmp/app/node_modules/@zitadel/server/bin/zitadel-server.js start",
    ],
    ["under bun", "/opt/bun/bin/bun /tmp/app/node_modules/@zitadel/server/bin/zitadel-server.js"],
  ])("finds the wrapper run %s", async (_, command) => {
    const { run } = whenPs((args) => {
      return args[0] === "axww" ? ` 890 1 ${command}\n` : "";
    });

    const discovery = await discoverManagedRuntimeProcesses({ run });

    expect(discovery.processes).toMatchObject([{ kind: "server-wrapper", pid: 890 }]);
  });

  it.each([
    ["a module to require first", "--require ./hook.js"],
    ["a module to preload", "-r dotenv/config"],
    ["a subcommand and its flags", "run --allow-all"],
  ])("finds the wrapper a runtime is given %s before", async (_, options) => {
    const { run } = whenPs((args) => {
      return args[0] === "axww"
        ? ` 901 1 /usr/local/bin/node ${options} /tmp/app/node_modules/@zitadel/server/bin/zitadel-server.js\n`
        : "";
    });

    const discovery = await discoverManagedRuntimeProcesses({ run });

    expect(discovery.processes).toMatchObject([{ kind: "server-wrapper", pid: 901 }]);
  });

  describe("when a path has a space in it", () => {
    it("finds the wrapper installed under it", async ({ dir }) => {
      const script = await aFileAt(join(dir, "Jane Doe/app/bin/zitadel-server.js"));
      const { run } = whenPs((args) => {
        return args[0] === "axww" ? ` 912 1 /usr/local/bin/node ${script} start\n` : "";
      });

      const discovery = await discoverManagedRuntimeProcesses({ run });

      expect(discovery.processes).toMatchObject([{ kind: "server-wrapper", pid: 912 }]);
    });

    it("finds the wrapper a runtime installed under it runs", async ({ dir }) => {
      const runtime = await aFileAt(join(dir, "Jane Doe/bin/node"));
      const { run } = whenPs((args) => {
        return args[0] === "axww" ? ` 923 1 ${runtime} /tmp/app/bin/zitadel-server.js\n` : "";
      });

      const discovery = await discoverManagedRuntimeProcesses({ run });

      expect(discovery.processes).toMatchObject([{ kind: "server-wrapper", pid: 923 }]);
    });

    it("leaves out a tool node runs on a wrapper under it", async ({ dir }) => {
      const tool = await aFileAt(join(dir, "bin/prettier"));
      const script = await aFileAt(join(dir, "Jane Doe/app/bin/zitadel-server.js"));
      const { run } = whenPs((args) => {
        return args[0] === "axww" ? ` 934 1 /usr/local/bin/node ${tool} ${script}\n` : "";
      });

      const discovery = await discoverManagedRuntimeProcesses({ run });

      expect(discovery.processes).toEqual([]);
    });
  });

  it("reports unsupported discovery instead of throwing", async () => {
    const enoent: NodeJS.ErrnoException = Object.assign(new Error("spawn ps ENOENT"), {
      code: "ENOENT",
    });
    const run: Run = async () => {
      throw enoent;
    };

    await expect(discoverManagedRuntimeProcesses({ run })).resolves.toMatchObject({
      supported: false,
      processes: [],
    });
  });
});
