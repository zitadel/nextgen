import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveServerCommand, stopBinaryRuntime } from "../../../../src/lib/local-server/binary";

describe("local server binary helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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
