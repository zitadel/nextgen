import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

type DevProcessModule = {
  isDirectRun: (moduleUrl: string, argv?: string[]) => boolean;
};

async function loadModule(): Promise<DevProcessModule> {
  return (await import(
    new URL("../../../../../scripts/dev-process.mjs", import.meta.url).href
  )) as DevProcessModule;
}

describe("dev-process helpers", () => {
  it("detects direct script execution when argv[1] is relative", async () => {
    const { isDirectRun } = await loadModule();
    const relativePath = "scripts/run-cli.mjs";
    const moduleUrl = pathToFileURL(resolve(relativePath)).href;

    expect(isDirectRun(moduleUrl, [process.execPath, relativePath])).toBe(true);
  });

  it("returns false for imports or different entrypoints", async () => {
    const { isDirectRun } = await loadModule();
    const moduleUrl = pathToFileURL(resolve("scripts/run-cli.mjs")).href;

    expect(isDirectRun(moduleUrl, [process.execPath])).toBe(false);
    expect(isDirectRun(moduleUrl, [process.execPath, "scripts/doctor.mjs"])).toBe(false);
  });
});
