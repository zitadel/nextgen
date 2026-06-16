import { execFile } from "node:child_process";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const mockExecFile = vi.mocked(execFile);

import { discoverManagedRuntimeProcesses } from "../../../../src/lib/local-server/processes";

function whenPs(
  impl: (
    args: readonly string[],
    cb: (err: NodeJS.ErrnoException | null, stdout: string) => void,
  ) => void,
): void {
  mockExecFile.mockImplementation(((
    file: string,
    args: readonly string[],
    _opts: unknown,
    cb: (err: NodeJS.ErrnoException | null, stdout: string) => void,
  ) => {
    expect(file).toBe("ps");
    impl(args, cb);
    return undefined as never;
  }) as never);
}

beforeEach(() => {
  mockExecFile.mockReset();
});

describe("discoverManagedRuntimeProcesses", () => {
  it("returns only CLI-managed local runtime processes", async () => {
    whenPs((args, cb) => {
      if (args[0] === "axo") {
        cb(
          null,
          [
            " 123 1 /usr/local/bin/node /tmp/app/node_modules/@zitadel/server/bin/zitadel-server.js",
            " 234 123 /tmp/app/node_modules/@zitadel/server-darwin-arm64/bin/nextgen",
            " 345 1 /usr/local/bin/nextgen",
            " 456 1 /usr/bin/node /tmp/other.js",
            "",
          ].join("\n"),
        );
        return;
      }
      const pid = String(args[2]);
      const env =
        pid === "234"
          ? "NEXTGEN_SERVER_DATA_DIR=/tmp/app/.zitadel/local/nextgen-data /tmp/app/node_modules/@zitadel/server-darwin-arm64/bin/nextgen"
          : pid === "345"
            ? "NEXTGEN_SERVER_DATA_DIR=/tmp/app/.zitadel/local/nextgen-data /usr/local/bin/nextgen"
            : "";
      cb(null, env);
    });

    await expect(discoverManagedRuntimeProcesses()).resolves.toMatchObject({
      supported: true,
      processes: [
        { kind: "server-wrapper", pid: 123, ppid: 1 },
        { kind: "server-binary", pid: 234, ppid: 123 },
        { kind: "server-binary", pid: 345, ppid: 1 },
      ],
    });
  });

  it("reports unsupported discovery instead of throwing", async () => {
    const enoent: NodeJS.ErrnoException = Object.assign(new Error("spawn ps ENOENT"), {
      code: "ENOENT",
    });
    whenPs((_args, cb) => cb(enoent, ""));

    await expect(discoverManagedRuntimeProcesses()).resolves.toMatchObject({
      supported: false,
      processes: [],
    });
  });
});
