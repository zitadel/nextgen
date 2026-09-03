import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveServerCommand,
  startBinaryRuntime,
  stopBinaryRuntime,
} from "../../../../src/lib/local-server/binary";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(() => ({ pid: 4242, unref: () => undefined })) };
});

describe("local server binary helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("spawns the server with the address, data dir, public base, and platform bootstrap env", async () => {
    vi.stubEnv("ZITADEL_SERVER_BINARY", "/tmp/fake-nextgen-server");
    const dir = await mkdtemp(join(tmpdir(), "zitadel-binary-test-"));

    await startBinaryRuntime({
      cliVersion: "0.0.0-test",
      dataDir: join(dir, "data"),
      logPath: join(dir, "logs", "server.log"),
      port: 8091,
      serverUrl: "http://localhost:8091",
    });

    const [, , options] = vi.mocked(spawn).mock.calls[0] as unknown as [
      string,
      string[],
      { env: NodeJS.ProcessEnv },
    ];
    expect(options.env.NEXTGEN_SERVER_ADDRESS).toBe(":8091");
    expect(options.env.NEXTGEN_SERVER_PUBLIC_BASE).toBe("http://localhost:8091");
    // Without the platform project the claim page cannot sign anyone in and
    // `claim/complete` refuses every session, so a local claim never lands.
    expect(options.env.NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT).toBe("true");
  });

  it("records an explicit source build version with a binary override", () => {
    expect(
      resolveServerCommand({
        ZITADEL_SERVER_BINARY: "/repo/dist/server/nextgen",
        ZITADEL_SERVER_BINARY_VERSION: "dev+abcdef123456",
      }),
    ).toEqual({
      command: "/repo/dist/server/nextgen",
      args: [],
      serverPackage: "@zitadel/server",
      serverVersion: "dev+abcdef123456",
    });
  });

  it("keeps the generic label for an unversioned user override", () => {
    expect(
      resolveServerCommand({ ZITADEL_SERVER_BINARY: "/tmp/custom-nextgen" }).serverVersion,
    ).toBe("override");
  });

  it("falls back from process-group SIGTERM to pid SIGTERM and reports a stale process", async () => {
    const kill = vi
      .spyOn(process, "kill")
      .mockImplementation((_pid: number, signal?: NodeJS.Signals | number) => {
        if (_pid === -12345 && signal === "SIGTERM") {
          throw errno("ESRCH");
        }
        if (signal === "SIGTERM") {
          throw errno("ESRCH");
        }
        return true;
      });

    await expect(stopBinaryRuntime(12345)).resolves.toMatchObject({
      pid: 12345,
      status: "stale",
      target: "process",
    });

    expect(kill).toHaveBeenCalledWith(12345, 0);
    expect(kill).toHaveBeenCalledWith(-12345, "SIGTERM");
    expect(kill).toHaveBeenCalledWith(12345, "SIGTERM");
  });

  it("sends SIGKILL to the process group when SIGTERM does not stop it", async () => {
    vi.useFakeTimers();
    const kill = vi
      .spyOn(process, "kill")
      .mockImplementation((_pid: number, _signal?: NodeJS.Signals | number) => {
        return true;
      });

    const stopped = stopBinaryRuntime(12345);
    await vi.advanceTimersByTimeAsync(12_500);

    await expect(stopped).resolves.toMatchObject({
      pid: 12345,
      status: "failed",
      target: "process-group",
      signal: "SIGKILL",
    });
    expect(kill).toHaveBeenCalledWith(-12345, "SIGTERM");
    expect(kill).toHaveBeenCalledWith(-12345, "SIGKILL");
  });
});

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}
