import { execFile as execFileCallback } from "node:child_process";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { describe, expect } from "vitest";

import { it } from "../../helpers/fixtures";

const execFile = promisify(execFileCallback);

const devProcessUrl = new URL("../../../../../scripts/dev-process.mjs", import.meta.url);

type DevProcessModule = {
  isDirectRun: (moduleUrl: string, argv?: string[]) => boolean;
  mapAll: <T, R>(
    items: T[],
    worker: (item: T, index: number) => Promise<R>,
    concurrency: number,
  ) => Promise<R[]>;
};

async function loadModule(): Promise<DevProcessModule> {
  return (await import(devProcessUrl.href)) as DevProcessModule;
}

/** The absolute path of a script beside `scripts/dev-process.mjs`. */
function repoScript(name: string): string {
  return fileURLToPath(new URL(name, devProcessUrl));
}

describe("dev-process helpers", () => {
  it("detects direct script execution when argv[1] is relative", async () => {
    const { isDirectRun } = await loadModule();
    const scriptPath = repoScript("run-cli.mjs");
    const moduleUrl = pathToFileURL(scriptPath).href;

    expect(isDirectRun(moduleUrl, [process.execPath, relative(process.cwd(), scriptPath)])).toBe(
      true,
    );
  });

  it("returns false for imports or different entrypoints", async () => {
    const { isDirectRun } = await loadModule();
    const moduleUrl = pathToFileURL(repoScript("run-cli.mjs")).href;

    expect(isDirectRun(moduleUrl, [process.execPath])).toBe(false);
    expect(isDirectRun(moduleUrl, [process.execPath, repoScript("doctor.mjs")])).toBe(false);
  });

  it("returns false instead of throwing when a path does not resolve", async () => {
    const { isDirectRun } = await loadModule();
    const scriptPath = repoScript("run-cli.mjs");

    expect(isDirectRun(pathToFileURL(scriptPath).href, [process.execPath, "missing.mjs"])).toBe(
      false,
    );
    expect(isDirectRun("node:fs", [process.execPath, scriptPath])).toBe(false);
  });

  it("runs the main block of a script started through a symlink", async ({ dir }) => {
    await mkdir(join(dir, "checkout"));
    await writeFile(
      join(dir, "checkout", "main.mjs"),
      `import { isDirectRun } from ${JSON.stringify(devProcessUrl.href)};
if (isDirectRun(import.meta.url)) console.log("main block ran");
`,
    );
    await symlink(join(dir, "checkout"), join(dir, "link"));

    const { stdout } = await execFile(process.execPath, [join(dir, "link", "main.mjs")]);

    expect(stdout).toBe("main block ran\n");
  });
});

describe("mapAll", () => {
  it("returns the results in input order", async () => {
    const { mapAll } = await loadModule();

    await expect(mapAll([3, 1, 2], async (item) => item * 10, 2)).resolves.toEqual([30, 10, 20]);
  });

  it("rethrows the failed job's own error, not a wrapper around it", async () => {
    const { mapAll } = await loadModule();

    await expect(
      mapAll(
        ["a", "b"],
        async (item) => {
          throw new Error(`boom on ${item}`);
        },
        1,
      ),
    ).rejects.toThrow("boom on a");
  });

  it("lets the jobs already running finish before it fails", async () => {
    const { mapAll } = await loadModule();
    const started = performance.now();

    await expect(
      mapAll(
        [0, 1],
        async (item) => {
          if (item === 0) {
            throw new Error("boom");
          }
          await delay(40);
        },
        2,
      ),
    ).rejects.toThrow("boom");

    expect(performance.now() - started).toBeGreaterThanOrEqual(35);
  });
});
