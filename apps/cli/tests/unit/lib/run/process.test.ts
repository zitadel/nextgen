import { describe, expect, it } from "vitest";

import { SupervisedProcess } from "../../../../src/lib/run/process";

/** Waits for `predicate`, so a test never races a child process's startup. */
async function until(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(predicate()).toBe(true);
}

describe("SupervisedProcess", () => {
  it("streams the child's stdout and stderr to one sink", async () => {
    const chunks: string[] = [];
    const child = new SupervisedProcess({
      command: process.execPath,
      args: ["-e", "console.log('out'); console.error('err');"],
      onOutput: (chunk) => chunks.push(chunk),
    });

    child.start();
    await until(() => chunks.join("").includes("out") && chunks.join("").includes("err"));
    await child.stop();
  });

  it("reports an exit the session did not ask for", async () => {
    const exits: Array<{ code: number | null }> = [];
    const child = new SupervisedProcess({
      command: process.execPath,
      args: ["-e", "process.exit(3);"],
      onOutput: () => undefined,
      onUnexpectedExit: (info) => exits.push(info),
    });

    child.start();
    await until(() => exits.length === 1);

    expect(exits[0]?.code).toBe(3);
    expect(child.running).toBe(false);
  });

  it("stays quiet about an exit it asked for", async () => {
    let unexpected = 0;
    const child = new SupervisedProcess({
      command: process.execPath,
      args: ["-e", "setInterval(() => undefined, 1000);"],
      onOutput: () => undefined,
      onUnexpectedExit: () => {
        unexpected += 1;
      },
    });

    child.start();
    const pid = child.pid;
    await child.stop();

    expect(unexpected).toBe(0);
    expect(child.running).toBe(false);
    expect(pid).toBeDefined();
  });

  it("kills a child that ignores SIGTERM", async () => {
    const child = new SupervisedProcess({
      command: process.execPath,
      args: [
        "-e",
        "process.on('SIGTERM', () => undefined); setInterval(() => undefined, 1000); console.log('armed');",
      ],
      onOutput: () => undefined,
    });

    child.start();
    const pid = child.pid;
    // Long enough for the SIGTERM grace to run out and the SIGKILL to land.
    await child.stop();

    expect(child.running).toBe(false);
    expect(pid && isRunning(pid)).toBe(false);
  }, 20_000);

  it("starts again after it was stopped", async () => {
    const chunks: string[] = [];
    const child = new SupervisedProcess({
      command: process.execPath,
      args: ["-e", "console.log('hello'); setInterval(() => undefined, 1000);"],
      onOutput: (chunk) => chunks.push(chunk),
    });

    child.start();
    await until(() => chunks.length === 1);
    await child.stop();
    child.start();
    await until(() => chunks.length === 2);
    await child.stop();

    expect(chunks.join("")).toBe("hello\nhello\n");
  });

  it("reports a command that does not exist instead of throwing", async () => {
    const chunks: string[] = [];
    const child = new SupervisedProcess({
      command: "zitadel-no-such-binary",
      args: [],
      onOutput: (chunk) => chunks.push(chunk),
    });

    child.start();
    await until(() => chunks.length > 0);

    expect(chunks.join("")).toContain("ENOENT");
  });
});

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
