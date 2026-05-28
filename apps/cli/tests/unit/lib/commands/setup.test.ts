import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runSetup } from "../../../../src/lib/commands/setup";
import type { SetupOptions } from "../../../../src/lib/commands/setup";

function makeOpts(cwd: string, overrides: Partial<SetupOptions> = {}): SetupOptions {
  return {
    cwd,
    nonInteractive: true,
    dryRun: false,
    force: false,
    command: "setup",
    cliVersion: "0.0.0",
    source: "https://api.zitadel.cloud",
    verbose: false,
    debug: false,
    env: {},
    isTTY: false,
    ...overrides,
  };
}

const tempDirs: string[] = [];

/** A minimal detectable Next.js App Router project (no Zitadel files yet). */
async function makeNextProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-"));
  tempDirs.push(cwd);
  await mkdir(join(cwd, "app"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "demo", dependencies: { next: "^15" } }),
  );
  await writeFile(join(cwd, "app/layout.tsx"), "export default function L() {}\n");
  return cwd;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("runSetup", () => {
  it("skips when the project is already initialized", async () => {
    const cwd = await makeNextProject();
    await writeFile(join(cwd, "zitadel.json"), JSON.stringify({ project: "existing" }));

    const result = await runSetup(makeOpts(cwd));

    expect(result.status).toBe("skipped");
    if (result.status !== "skipped") {
      throw new Error("expected skipped");
    }
    expect(result.reason).toBe("already-initialized");
  });

  it("throws E_CONFLICT when a secret exists without zitadel.json", async () => {
    const cwd = await makeNextProject();
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/secret"), "{}");

    await expect(runSetup(makeOpts(cwd))).rejects.toMatchObject({ code: "E_CONFLICT" });
  });

  it("dry-run returns ok with a stub project and contacts no platform", async () => {
    const cwd = await makeNextProject();

    const result = await runSetup(makeOpts(cwd, { dryRun: true, noApply: true, framework: "next" }));

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("expected ok");
    }
    const data = result.data as { project: { project_id: string }; apply?: unknown };
    expect(data.project.project_id).toBe("dry-run-0000");
    // dry-run never applies, so no apply summary is attached.
    expect(data.apply).toBeUndefined();
  });

  it("errors in a non-interactive empty directory without --framework", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-empty-"));
    tempDirs.push(cwd);

    await expect(runSetup(makeOpts(cwd))).rejects.toMatchObject({
      code: "E_FRAMEWORK_NOT_DETECTED",
    });
  });
});
