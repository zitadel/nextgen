import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type Options = { mutex: string | null; retries: number; command: string[] };
type Result = { code?: number; signal?: string };

type TaskGuardModule = {
  parseArgs: (argv: string[]) => Options;
  lockDir: (name: string, root?: string, base?: string) => string;
  acquire: (dir: string, options?: { maxWaitMs?: number }) => Promise<() => void>;
  guard: (
    options: Options,
    deps?: {
      env?: Record<string, string | undefined>;
      lockBase?: string;
      log?: (line: string) => void;
    },
  ) => Promise<Result>;
};

const script = fileURLToPath(new URL("../../../../../scripts/task-guard.mjs", import.meta.url));

async function loadModule(): Promise<TaskGuardModule> {
  return (await import(new URL(`file://${script}`).href)) as TaskGuardModule;
}

// A command that records each attempt in `file` and fails until the
// `succeedOn`-th one.
function countingCommand(file: string, succeedOn: number): string[] {
  const code = `const fs = require("node:fs");
const n = (fs.existsSync(process.argv[1]) ? Number(fs.readFileSync(process.argv[1], "utf8")) : 0) + 1;
fs.writeFileSync(process.argv[1], String(n));
process.exit(n < ${succeedOn} ? 1 : 0);`;
  return [process.execPath, "-e", code, file];
}

async function attempts(file: string): Promise<number> {
  return Number(await readFile(file, "utf8"));
}

describe("task-guard outside turbo", () => {
  it("runs the command once, without a lock, and passes its exit code on", async () => {
    const { guard } = await loadModule();
    const dir = await mkdtemp(join(tmpdir(), "task-guard-"));
    const counter = join(dir, "count");
    const lockBase = join(dir, "locks");

    const result = await guard(
      { mutex: "browser-tests", retries: 3, command: countingCommand(counter, 99) },
      { env: {}, lockBase },
    );

    expect(result).toEqual({ code: 1 });
    expect(await attempts(counter)).toBe(1);
    await expect(readdir(lockBase)).rejects.toThrow();
  });

  it("reports a signal so the caller can die of it", async () => {
    const { guard } = await loadModule();
    const result = await guard(
      {
        mutex: null,
        retries: 0,
        command: [process.execPath, "-e", 'process.kill(process.pid, "SIGTERM")'],
      },
      { env: {} },
    );
    expect(result).toEqual({ signal: "SIGTERM" });
  });
});

describe("task-guard under turbo", () => {
  it("retries a failing command until it passes", async () => {
    const { guard } = await loadModule();
    const dir = await mkdtemp(join(tmpdir(), "task-guard-"));
    const counter = join(dir, "count");

    const result = await guard(
      { mutex: "browser-tests", retries: 3, command: countingCommand(counter, 3) },
      { env: { TURBO_HASH: "abc" }, lockBase: join(dir, "locks"), log: () => {} },
    );

    expect(result).toEqual({ code: 0 });
    expect(await attempts(counter)).toBe(3);
  });

  it("gives up after the last retry with the command's exit code", async () => {
    const { guard } = await loadModule();
    const dir = await mkdtemp(join(tmpdir(), "task-guard-"));
    const counter = join(dir, "count");

    const result = await guard(
      { mutex: null, retries: 2, command: countingCommand(counter, 99) },
      { env: { TURBO_HASH: "abc" }, log: () => {} },
    );

    expect(result).toEqual({ code: 1 });
    expect(await attempts(counter)).toBe(3);
  });

  it("releases the lock when the command is done", async () => {
    const { guard, lockDir } = await loadModule();
    const dir = await mkdtemp(join(tmpdir(), "task-guard-"));
    const lockBase = join(dir, "locks");

    await guard(
      { mutex: "generated-sources", retries: 0, command: [process.execPath, "-e", "0"] },
      { env: { TURBO_HASH: "abc" }, lockBase, log: () => {} },
    );

    await expect(readdir(lockDir("generated-sources", undefined, lockBase))).rejects.toThrow();
  });
});

describe("the lock", () => {
  it("waits while a live process holds it", async () => {
    const { acquire, lockDir } = await loadModule();
    const lock = lockDir("held", "/repo", await mkdtemp(join(tmpdir(), "task-guard-")));
    await mkdir(lock, { recursive: true });
    await writeFile(join(lock, "pid"), `${process.pid}\n`);

    await expect(acquire(lock, { maxWaitMs: 300 })).rejects.toThrow(/gave up waiting/);
  });

  it("reclaims a lock whose holder is gone", async () => {
    const { acquire, lockDir } = await loadModule();
    const lock = lockDir("stale", "/repo", await mkdtemp(join(tmpdir(), "task-guard-")));
    await mkdir(lock, { recursive: true });
    // No process has this pid: pids stay far below it on Linux and macOS.
    await writeFile(join(lock, "pid"), "2147483646\n");

    const release = await acquire(lock, { maxWaitMs: 1000 });
    expect((await readFile(join(lock, "pid"), "utf8")).trim()).toBe(String(process.pid));
    release();
  });
});

describe("the command line", () => {
  it("runs the command when the script is reached through a symlink", async () => {
    const dir = await mkdtemp(join(tmpdir(), "task-guard-"));
    const link = join(dir, "task-guard.mjs");
    await symlink(script, link);

    const run = spawnSync(
      process.execPath,
      [link, "--", process.execPath, "-e", "process.exit(3)"],
      {
        env: { ...process.env, TURBO_HASH: "" },
      },
    );

    expect(run.status).toBe(3);
  });

  it("exits 127 when the command does not exist, as the shell does", () => {
    const run = spawnSync(process.execPath, [script, "--", "task-guard-no-such-command"], {
      env: { ...process.env, TURBO_HASH: "" },
    });
    expect(run.status).toBe(127);
  });
});
