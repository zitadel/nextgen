import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { bootLocalServer } from "../../src/lifecycle";
import { fakeCliBin } from "./helpers/fake-cli";

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

describe("bootLocalServer", () => {
  it("boots via the CLI and parses the start envelope", async () => {
    const fake = await fakeCliBin();
    const server = await bootLocalServer({ cliBin: fake.binPath, port: 18092 });

    expect(server.baseUrl).toBe("http://localhost:18092");
    expect(server.runtime.port).toBe(18092);
    expect(server.runtime.pid).toBe(4242);
    expect(server.runtime.logPath).toContain(".zitadel/local/server.log");

    const calls = await fake.calls();
    expect(calls).toHaveLength(1);
    const [startArgs] = calls;
    expect(startArgs[0]).toBe("start");
    expect(startArgs).toContain("--non-interactive");
    expect(startArgs).toContain("--json");
    expect(startArgs).toContain("-c");
    expect(startArgs[startArgs.indexOf("-c") + 1]).toBe(server.runtime.dir);

    await server.stop();
  });

  it("picks a free port when none is given", async () => {
    const fake = await fakeCliBin();
    const server = await bootLocalServer({ cliBin: fake.binPath });

    expect(server.runtime.port).toBeGreaterThan(0);
    expect(server.runtime.port).toBeLessThan(65_536);
    expect(server.baseUrl).toBe(`http://localhost:${server.runtime.port}`);

    await server.stop();
  });

  it("surfaces stderr and keeps the state dir when start fails", async () => {
    const fake = await fakeCliBin({ startExitCode: 1, startStderr: "boom: port taken" });
    let error: Error | undefined;
    try {
      await bootLocalServer({ cliBin: fake.binPath });
    } catch (caught) {
      error = caught as Error;
    }
    expect(error).toBeDefined();
    expect(error?.message).toContain("exited with code 1");
    expect(error?.message).toContain("boom: port taken");
    const keptDir = /state dir kept for inspection: (.+)$/m.exec(error?.message ?? "")?.[1];
    expect(keptDir).toBeDefined();
    await expect(exists(keptDir as string)).resolves.toBe(true);
  });

  it("rejects on non-envelope stdout", async () => {
    const fake = await fakeCliBin({ startStdout: "definitely not json" });
    await expect(bootLocalServer({ cliBin: fake.binPath })).rejects.toThrow(
      /expected a JSON envelope/,
    );
  });

  it("stops via the CLI and removes the owned temp dir", async () => {
    const fake = await fakeCliBin();
    const server = await bootLocalServer({ cliBin: fake.binPath });
    await expect(exists(server.runtime.dir)).resolves.toBe(true);

    await server.stop();

    const calls = await fake.calls();
    expect(calls).toHaveLength(2);
    const stopArgs = calls[1];
    expect(stopArgs[0]).toBe("stop");
    expect(stopArgs[stopArgs.indexOf("-c") + 1]).toBe(server.runtime.dir);
    await expect(exists(server.runtime.dir)).resolves.toBe(false);
  });

  it("keeps the owned dir when keep is set", async () => {
    const fake = await fakeCliBin();
    const server = await bootLocalServer({ cliBin: fake.binPath, keep: true });
    await server.stop();
    await expect(exists(server.runtime.dir)).resolves.toBe(true);
  });

  it("never removes a caller-provided dir", async () => {
    const fake = await fakeCliBin();
    const dir = await mkdtemp(join(tmpdir(), "zitadel-testing-caller-dir-"));
    const server = await bootLocalServer({ cliBin: fake.binPath, dir });
    expect(server.runtime.dir).toBe(dir);
    await server.stop();
    await expect(exists(dir)).resolves.toBe(true);
  });

  it("propagates stop failures and keeps the dir", async () => {
    const fake = await fakeCliBin({ stopExitCode: 1 });
    const server = await bootLocalServer({ cliBin: fake.binPath });
    await expect(server.stop()).rejects.toThrow(/zitadel stop exited with code 1/);
    await expect(exists(server.runtime.dir)).resolves.toBe(true);
  });

  it("is idempotent on stop", async () => {
    const fake = await fakeCliBin();
    const server = await bootLocalServer({ cliBin: fake.binPath });
    await server.stop();
    await server.stop();
    const calls = await fake.calls();
    expect(calls.filter((args) => args[0] === "stop")).toHaveLength(1);
  });
});
