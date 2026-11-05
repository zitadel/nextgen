import { execFile as execFileCallback } from "node:child_process";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";

const execFile = promisify(execFileCallback);

const devProcessUrl = new URL("../../../../../scripts/dev-process.mjs", import.meta.url);

type DevProcessModule = {
  isDirectRun: (moduleUrl: string, argv?: string[]) => boolean;
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
