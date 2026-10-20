import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it, vi } from "vitest";

const execFile = promisify(execFileCallback);

const devProcessUrl = new URL("../../../../../scripts/dev-process.mjs", import.meta.url);

type DevProcessModule = {
  isDirectRun: (moduleUrl: string, argv?: string[]) => boolean;
  runBuffered: (
    command: string,
    args?: string[],
    options?: { env?: NodeJS.ProcessEnv },
  ) => Promise<{ stdout: string; stderr: string }>;
  mapWithConcurrency: <T, R>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
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

  it("runs the main block of a script started through a symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "zitadel-dev-process-"));
    try {
      await mkdir(join(root, "checkout"));
      await writeFile(
        join(root, "checkout", "main.mjs"),
        `import { isDirectRun } from ${JSON.stringify(devProcessUrl.href)};
if (isDirectRun(import.meta.url)) console.log("main block ran");
`,
      );
      await symlink(join(root, "checkout"), join(root, "link"));

      const { stdout } = await execFile(process.execPath, [join(root, "link", "main.mjs")]);

      expect(stdout).toBe("main block ran\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("runBuffered", () => {
  const printer = (code: number) => [
    "-e",
    `process.stdout.write("out-line\\n"); process.stderr.write("err-line\\n"); process.exit(${code});`,
  ];

  it("returns the child's output and replays it once the child has exited", async () => {
    const { runBuffered } = await loadModule();
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const result = await runBuffered(process.execPath, printer(0));
      expect(result.stdout).toBe("out-line\n");
      expect(out).toHaveBeenCalledWith("out-line\n");
      expect(err).toHaveBeenCalledWith("err-line\n");
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });

  it("replays the output of a failing child and keeps the error to one line", async () => {
    const { runBuffered } = await loadModule();
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const failure = await runBuffered(process.execPath, printer(3)).catch((e) => e);
      expect(failure.code).toBe(3);
      expect(failure.message).not.toContain("\n");
      expect(out).toHaveBeenCalledWith("out-line\n");
      expect(err).toHaveBeenCalledWith("err-line\n");
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });
});

describe("mapWithConcurrency", () => {
  it("preserves input order in results and never exceeds the limit", async () => {
    const { mapWithConcurrency } = await loadModule();

    let inFlight = 0;
    let peak = 0;
    const results = await mapWithConcurrency([5, 4, 3, 2, 1], 2, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // Later items finish faster to prove results are ordered by input,
      // not by completion.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, item * 4));
      inFlight -= 1;
      return item * 10;
    });

    expect(results).toEqual([50, 40, 30, 20, 10]);
    expect(peak).toBe(2);
  });

  it("stops starting new work after a failure and rethrows the first error", async () => {
    const { mapWithConcurrency } = await loadModule();

    const started: number[] = [];
    await expect(
      mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (item) => {
        started.push(item);
        if (item === 1) {
          throw new Error(`boom on ${item}`);
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
        return item;
      }),
    ).rejects.toThrow("boom on 1");

    // Lanes finish their in-flight item but pull nothing new once failed.
    expect(started.length).toBeLessThan(6);
  });

  it("handles empty input and limits larger than the input", async () => {
    const { mapWithConcurrency } = await loadModule();

    await expect(mapWithConcurrency([], 4, async () => "x")).resolves.toEqual([]);
    await expect(
      mapWithConcurrency(["a", "b"], 16, async (item, index) => `${item}${index}`),
    ).resolves.toEqual(["a0", "b1"]);
  });

  it("rejects limits that are not positive integers instead of silently no-oping", async () => {
    const { mapWithConcurrency } = await loadModule();

    // A NaN limit previously produced zero worker lanes: the call returned
    // an all-undefined result array without running any work.
    for (const limit of [Number.NaN, 0, -1, 2.5, Number.POSITIVE_INFINITY]) {
      await expect(mapWithConcurrency(["a"], limit, async (item) => item)).rejects.toThrow(
        "positive integer limit",
      );
    }
  });
});
