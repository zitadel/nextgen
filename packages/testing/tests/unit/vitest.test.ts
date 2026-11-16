import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, onTestFinished, vi } from "vitest";
import type { TestProject } from "vitest/node";

import type { InstanceHandle } from "../../src/types";
import { injectZitadel, zitadelGlobalSetup } from "../../src/vitest";
import { it as base } from "./fixtures";
import { bootstrapHandlers } from "./helpers/bootstrap-api";
import { fakeCliBin, type FakeCli } from "./helpers/fake-cli";

// The entry's reader goes through Vitest's own inject(); stand in for the
// worker side of provide/inject so a test can play both halves of a run.
const provided = vi.hoisted(() => new Map<string, unknown>());
vi.mock("vitest", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vitest")>()),
  inject: (key: string) => provided.get(key),
}));

// The fake CLI never binds ports; msw answers on whatever port the test was given.
const it = base.extend<{ origin: string; handled: undefined }>({
  origin: async ({ port }, use) => {
    await use(`http://localhost:${port}`);
  },
  handled: [
    async ({ server, origin }, use) => {
      server.use(...bootstrapHandlers(origin));
      await use(undefined);
    },
    { auto: true },
  ],
});

beforeEach(() => provided.clear());

/** The slice of a TestProject the global setup touches. */
function fakeProject(): TestProject {
  return {
    provide: (key: string, value: unknown) => provided.set(key, value),
  } as unknown as TestProject;
}

/** The CLI calls so far, read synchronously from the fake's record. */
function callsNow(fake: FakeCli): string[][] {
  return readFileSync(join(dirname(fake.binPath), "calls.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
}

/** The state dir the fake CLI was started with. */
function startedDir(fake: FakeCli): string {
  const start = callsNow(fake).find((args) => args[0] === "start") ?? [];
  return start[start.indexOf("-c") + 1] as string;
}

describe("zitadelGlobalSetup", () => {
  it("boots one instance, provides its handle, and stops it on teardown", async ({
    port,
    origin,
  }) => {
    const fake = await fakeCliBin();
    const teardown = await zitadelGlobalSetup({
      cliBin: fake.binPath,
      port,
      appOrigins: ["http://localhost:3002"],
    })(fakeProject());

    // Exactly one value crosses to the workers, and it is the plain handle.
    expect(provided.size).toBe(1);
    const [handle] = [...provided.values()] as InstanceHandle[];
    expect(handle).toEqual({
      baseUrl: origin,
      projectId: "proj_1",
      projectSecret: "secret_1",
      schemaId: "sch_1",
      previewSecret: "preview_1",
      appOrigin: "http://localhost:3002",
    });
    expect(JSON.parse(JSON.stringify(handle))).toEqual(handle);

    let calls = await fake.calls();
    expect(calls.filter((args) => args[0] === "start")).toHaveLength(1);
    expect(calls.filter((args) => args[0] === "stop")).toHaveLength(0);

    await teardown();
    calls = await fake.calls();
    expect(calls.filter((args) => args[0] === "stop")).toHaveLength(1);
  });

  describe.each(["SIGINT", "SIGTERM"] as const)("on %s", (signal) => {
    // Run with only the listeners a test installs, and keep process.kill from
    // delivering a real signal to the test worker.
    let saved: NodeJS.SignalsListener[];
    let kill: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      saved = process.listeners(signal);
      process.removeAllListeners(signal);
      kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    });
    afterEach(() => {
      kill.mockRestore();
      process.removeAllListeners(signal);
      for (const listener of saved) {
        process.on(signal, listener);
      }
    });

    it("stops the instance before the handler returns and removes its dir", async ({ port }) => {
      const fake = await fakeCliBin();
      await zitadelGlobalSetup({ cliBin: fake.binPath, port })(fakeProject());
      const dir = startedDir(fake);
      expect(existsSync(dir)).toBe(true);

      process.emit(signal, signal);

      // No await in between: Vitest exits a tick after the signal.
      expect(callsNow(fake).filter((args) => args[0] === "stop")).toEqual([
        ["stop", "--non-interactive", "--json", "-c", dir],
      ]);
      expect(existsSync(dir)).toBe(false);
      expect(process.listenerCount(signal)).toBe(0);
    });

    it("re-raises the signal when nothing else ends the process", async ({ port }) => {
      const fake = await fakeCliBin();
      await zitadelGlobalSetup({ cliBin: fake.binPath, port })(fakeProject());

      process.emit(signal, signal);

      expect(kill).toHaveBeenCalledWith(process.pid, signal);
    });

    it("leaves the exit to the runner's own handler", async ({ port }) => {
      const runnerExit = vi.fn();
      process.on(signal, runnerExit);
      const fake = await fakeCliBin();
      await zitadelGlobalSetup({ cliBin: fake.binPath, port })(fakeProject());

      process.emit(signal, signal);

      expect(runnerExit).toHaveBeenCalledOnce();
      expect(kill).not.toHaveBeenCalled();
      expect(callsNow(fake).filter((args) => args[0] === "stop")).toHaveLength(1);
    });

    it("drops its handler on teardown", async ({ port }) => {
      const fake = await fakeCliBin();
      const teardown = await zitadelGlobalSetup({ cliBin: fake.binPath, port })(fakeProject());
      expect(process.listenerCount(signal)).toBe(1);

      await teardown();

      expect(process.listenerCount(signal)).toBe(0);
    });
  });
});

describe("injectZitadel", () => {
  it("connects to the handle the global setup provided", async ({ port }) => {
    const fake = await fakeCliBin();
    const teardown = await zitadelGlobalSetup({ cliBin: fake.binPath, port })(fakeProject());
    onTestFinished(teardown);
    const zitadel = injectZitadel();
    expect(zitadel.handle).toEqual([...provided.values()][0]);
    expect(typeof zitadel.seedUser).toBe("function");
    expect(typeof zitadel.seedSession).toBe("function");
    expect(zitadel.identity().email).toMatch(/@/);
  });

  it("names the missing global setup when nothing was provided", () => {
    expect(() => injectZitadel()).toThrow(/zitadelGlobalSetup\(\).*test\.globalSetup/s);
  });
});
