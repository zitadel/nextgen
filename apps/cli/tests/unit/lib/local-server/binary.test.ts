import { afterEach, describe, expect, it, vi } from "vitest";

import { stopBinaryRuntime } from "../../../../src/lib/local-server/binary";

describe("local server binary helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("treats ESRCH while sending SIGTERM as an already-stopped process", async () => {
    const kill = vi
      .spyOn(process, "kill")
      .mockImplementation((_pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === "SIGTERM") {
          throw errno("ESRCH");
        }
        return true;
      });

    await expect(stopBinaryRuntime(12345)).resolves.toBeUndefined();

    expect(kill).toHaveBeenCalledWith(12345, 0);
    expect(kill).toHaveBeenCalledWith(12345, "SIGTERM");
  });

  it("treats ESRCH while sending SIGKILL as an already-stopped process", async () => {
    vi.useFakeTimers();
    const kill = vi
      .spyOn(process, "kill")
      .mockImplementation((_pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === "SIGKILL") {
          throw errno("ESRCH");
        }
        return true;
      });

    const stopped = stopBinaryRuntime(12345);
    await vi.advanceTimersByTimeAsync(10_200);

    await expect(stopped).resolves.toBeUndefined();
    expect(kill).toHaveBeenCalledWith(12345, "SIGKILL");
  });
});

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}
